import { describe, expect, it, vi } from "vitest";

import { chatCompletionsUrl, createChatModel, extractMessageText } from "../src/chat.js";
import { resolveLlm, type ChatLlm } from "../src/config.js";
import { ClassificationRejectedError } from "../src/model.js";

const KEY = `AIza${"k".repeat(35)}`;
const avatarId = "3f0a8a52-6f43-4a53-9d0e-1b6f0c1c2a77";

function chat(env: NodeJS.ProcessEnv): ChatLlm {
  const state = resolveLlm(env);
  if (!state.ready || state.llm.kind !== "chat") throw new Error("These settings do not describe a chat provider.");
  return state.llm;
}

const gemini = chat({ LLM_API_KEY: KEY });

describe("chat-completions client", () => {
  it("posts system and user messages and reads the classification and the stream", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { stream?: boolean };
      if (body.stream) {
        return sseResponse([chunk("Hello"), chunk(" there"), chunk("", "stop"), "data: [DONE]\n\n"]);
      }
      return jsonResponse({
        choices: [
          {
            message: {
              role: "assistant",
              content: '```json\n{"decision":"choose","avatarId":"' + avatarId + '","reason":"It is a budget question."}\n```',
            },
          },
        ],
      });
    });

    const model = createChatModel(gemini, fetchImpl as unknown as typeof fetch);
    const decision = await model.classify({
      content: "Can we afford two hires?",
      summaries: [{ id: avatarId, name: "Skeptical CFO", description: "Funds plans with numbers.", useWhen: ["Budgets"] }],
    });
    expect(decision).toEqual({ decision: "choose", avatarId, reason: "It is a budget question." });

    const deltas: string[] = [];
    for await (const delta of model.streamAnswer({ system: "Be brief.", prompt: "Hello" })) deltas.push(delta);
    expect(deltas).toEqual(["Hello", " there"]);

    const calls = fetchImpl.mock.calls;
    expect(calls[0]?.[0]).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(calls[0]?.[0]).toBe(chatCompletionsUrl(gemini));
    for (const call of calls) {
      const init = call[1] as RequestInit;
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
      const body = JSON.parse(String(init.body)) as { model: string; messages: Array<{ role: string; content: string }> };
      expect(body.model).toBe("gemini-flash-latest");
      expect(body.messages.map((message) => message.role)).toEqual(["system", "user"]);
    }
    expect((JSON.parse(String((calls[0]?.[1] as RequestInit).body)) as { stream?: boolean }).stream).toBeUndefined();
    expect((JSON.parse(String((calls[1]?.[1] as RequestInit).body)) as { stream?: boolean }).stream).toBe(true);
  });

  it("sends the earlier turns between the system prompt and the new message", async () => {
    const fetchImpl = vi.fn(async () => sseResponse([chunk("ok", "stop")]));
    const model = createChatModel(gemini, fetchImpl as unknown as typeof fetch);
    const history = [
      { role: "user" as const, content: "Can we afford two hires?" },
      { role: "assistant" as const, content: "Show me the payback." },
    ];
    for await (const _ of model.streamAnswer({ system: "Be the CFO.", prompt: "And the second point?", history })) void _;
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((JSON.parse(String(init.body)) as { messages: unknown }).messages).toEqual([
      { role: "system", content: "Be the CFO." },
      { role: "user", content: "Can we afford two hires?" },
      { role: "assistant", content: "Show me the payback." },
      { role: "user", content: "And the second point?" },
    ]);
  });

  it("asks for the check as a repeatable call and reads its verdict", async () => {
    const reply = { checks: { answers: true, sound: true, stance: false, voice: true }, advice: "Lead with the numbers." };
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: JSON.stringify(reply) } }] }));
    const model = createChatModel(gemini, fetchImpl as unknown as typeof fetch);
    const avatar = {
      id: avatarId,
      name: "Skeptical CFO",
      description: "Funds plans with numbers.",
      perspective: "Cash first.",
      voice: "Dry.",
      caresAbout: ["Cash runway"],
      ignores: [],
      useWhen: [],
      intensity: "balanced" as const,
      createdBy: "user" as const,
      createdAt: "2026-11-16T10:31:00Z",
      updatedAt: "2026-11-16T10:31:00Z",
    };
    expect(await model.evaluate({ avatar, content: "Can we afford it?", draft: "Maybe." })).toEqual(reply);

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { temperature?: number; stream?: boolean; messages: Array<{ role: string; content: string }> };
    expect(body.temperature).toBe(0);
    expect(body.stream).toBeUndefined();
    expect(body.messages[0]?.content).toContain("You check a draft answer");
    expect(body.messages[1]?.content).toContain("Draft:\nMaybe.");

    const unusable = vi.fn(async () => jsonResponse({ choices: [{ message: { content: '{"checks":{"answers":true}}' } }] }));
    await expect(
      createChatModel(gemini, unusable as unknown as typeof fetch).evaluate({ avatar, content: "Hi", draft: "Hello." }),
    ).rejects.toThrow(/The check returned a reply that could not be used/);
  });

  it("asks again without a temperature when the model accepts only its default", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: "Unsupported value: 'temperature' does not support 0 with this model." } }, 400))
      .mockResolvedValueOnce(
        jsonResponse({ choices: [{ message: { content: JSON.stringify({ decision: "choose", avatarId, reason: "It fits." }) } }] }),
      );
    const model = createChatModel(gemini, fetchImpl as unknown as typeof fetch);
    expect(await model.classify({ content: "Hi", summaries: [] })).toMatchObject({ decision: "choose" });
    const bodies = fetchImpl.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)) as { temperature?: number });
    expect(bodies[0]?.temperature).toBe(0);
    expect(bodies[1]).not.toHaveProperty("temperature");
  });

  it("accepts a stream that finishes with finish_reason and no [DONE]", async () => {
    const fetchImpl = vi.fn(async () => sseResponse([chunk("Hi"), chunk(" there", "stop")]));
    const model = createChatModel(gemini, fetchImpl as unknown as typeof fetch);
    const deltas: string[] = [];
    for await (const delta of model.streamAnswer({ system: "s", prompt: "p" })) deltas.push(delta);
    expect(deltas).toEqual(["Hi", " there"]);
  });

  it("ignores reasoning text and chunks without choices", async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "thinking" } }] })}\n\n`,
        chunk("Answer"),
        `data: ${JSON.stringify({ choices: [], usage: { total_tokens: 9 } })}\n\n`,
        "data: [DONE]\n\n",
      ]),
    );
    const model = createChatModel(gemini, fetchImpl as unknown as typeof fetch);
    const deltas: string[] = [];
    for await (const delta of model.streamAnswer({ system: "s", prompt: "p" })) deltas.push(delta);
    expect(deltas).toEqual(["Answer"]);
  });

  it("fails a stream that ends with neither [DONE] nor finish_reason", async () => {
    const fetchImpl = vi.fn(async () => sseResponse([chunk("Hi")]));
    const model = createChatModel(gemini, fetchImpl as unknown as typeof fetch);
    await expect(async () => {
      for await (const _ of model.streamAnswer({ system: "s", prompt: "p" })) void _;
    }).rejects.toThrow(/ended the answer stream before it finished/);
  });

  it("reports an error sent inside the stream, and a filtered answer", async () => {
    const failing = vi.fn(async () => sseResponse([`data: ${JSON.stringify({ error: { message: "quota exceeded" } })}\n\n`]));
    await expect(async () => {
      for await (const _ of createChatModel(gemini, failing as unknown as typeof fetch).streamAnswer({ system: "s", prompt: "p" })) void _;
    }).rejects.toThrow("quota exceeded");

    const filtered = vi.fn(async () => sseResponse([chunk("Hi", "content_filter")]));
    await expect(async () => {
      for await (const _ of createChatModel(gemini, filtered as unknown as typeof fetch).streamAnswer({ system: "s", prompt: "p" })) void _;
    }).rejects.toThrow("The provider stopped the answer before it finished (content_filter).");
  });

  it("names the service and LLM_API_KEY on 401", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: "bad key" } }, 401));
    const model = createChatModel(gemini, fetchImpl as unknown as typeof fetch);
    await expect(model.classify({ content: "Hi", summaries: [] })).rejects.toThrow(
      "Google Gemini returned 401. Check LLM_API_KEY, or set LLM_PROVIDER if the key belongs to another service.",
    );
  });

  it("removes the key from every kind of provider error", async () => {
    const echo = `upstream said ${KEY}`;
    const failures = [
      // A failed status whose body is passed on.
      () => jsonResponse({ error: { message: echo } }, 500),
      // An error object inside a successful reply.
      () => jsonResponse({ error: { message: echo } }),
    ];
    for (const respond of failures) {
      const model = createChatModel(gemini, vi.fn(async () => respond()) as unknown as typeof fetch);
      const failure = (await model.classify({ content: "Hi", summaries: [] }).catch((error: unknown) => error)) as Error;
      expect(failure.message).toContain("[redacted]");
      expect(failure.message).not.toContain(KEY);
    }

    // An error sent inside the answer stream.
    const streaming = vi.fn(async () => sseResponse([`data: ${JSON.stringify({ error: { message: echo } })}\n\n`]));
    const failure = (await (async () => {
      for await (const _ of createChatModel(gemini, streaming as unknown as typeof fetch).streamAnswer({ system: "s", prompt: "p" })) void _;
    })().catch((error: unknown) => error)) as Error;
    expect(failure.message).toBe("upstream said [redacted]");
  });

  it("delivers the text that arrived, then reports an answer cut short by a limit", async () => {
    for (const reason of ["length", "MAX_TOKENS"]) {
      const fetchImpl = vi.fn(async () => sseResponse([chunk("Partial answer"), chunk(" that is cut", reason), "data: [DONE]\n\n"]));
      const model = createChatModel(gemini, fetchImpl as unknown as typeof fetch);
      const deltas: string[] = [];
      await expect(async () => {
        for await (const delta of model.streamAnswer({ system: "s", prompt: "p" })) deltas.push(delta);
      }).rejects.toThrow(`The provider stopped the answer before it finished (${reason}).`);
      expect(deltas).toEqual(["Partial answer", " that is cut"]);
    }
  });

  it("passes on the provider's reason for other failures, even wrapped in an array", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([{ error: { message: "models/nope is not found" } }], 404));
    const model = createChatModel(gemini, fetchImpl as unknown as typeof fetch);
    await expect(model.classify({ content: "Hi", summaries: [] })).rejects.toThrow(
      "The provider returned 404. models/nope is not found",
    );
  });

  it("rejects a reply that is not the classification shape", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "I think the CFO fits." } }] }));
    const model = createChatModel(gemini, fetchImpl as unknown as typeof fetch);
    await expect(model.classify({ content: "Hi", summaries: [] })).rejects.toThrow("The model did not return JSON.");
    await expect(model.classify({ content: "Hi", summaries: [] })).rejects.toBeInstanceOf(ClassificationRejectedError);
  });

  it("names the field when a draft breaks a limit, so the retry can correct it", async () => {
    const reply = {
      decision: "propose",
      reason: "None fit.",
      draft: { name: "n".repeat(61), description: "d", perspective: "p", voice: "v", caresAbout: ["c"] },
    };
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: JSON.stringify(reply) } }] }));
    const model = createChatModel(gemini, fetchImpl as unknown as typeof fetch);
    const failure = await model.classify({ content: "Hi", summaries: [] }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ClassificationRejectedError);
    expect((failure as Error).message).toContain("draft.name:");
  });

  it("does not retry a provider failure as if it were a bad reply", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: "overloaded" } }, 500));
    const model = createChatModel(gemini, fetchImpl as unknown as typeof fetch);
    const failure = await model.classify({ content: "Hi", summaries: [] }).catch((error: unknown) => error);
    expect(failure).not.toBeInstanceOf(ClassificationRejectedError);
    expect((failure as Error).message).toBe("The provider returned 500. overloaded");
  });
});

describe("extractMessageText", () => {
  it("reads string content and a list of text parts", () => {
    expect(extractMessageText({ choices: [{ message: { content: "A" } }] })).toBe("A");
    expect(extractMessageText({ choices: [{ message: { content: [{ type: "text", text: "A" }, { type: "text", text: "B" }] } }] })).toBe("AB");
    expect(extractMessageText({ choices: [] })).toBe("");
  });
});

function chunk(text: string, finishReason?: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: text ? { content: text } : {}, finish_reason: finishReason ?? null }] })}\n\n`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const part of chunks) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}
