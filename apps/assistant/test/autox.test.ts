import { describe, expect, it, vi } from "vitest";

import { createAutoxModel, extractOutputText, responsesUrl } from "../src/autox.js";
import { loadConfig } from "../src/config.js";

const config = loadConfig({
  AUTOX_KEY: "test-key",
  AUTOX_USERNAME: "ada",
  AUTOX_BASE_URL: "https://chat.autox.corp.amdocs.azr/api/v1/proxy/openai/",
  AUTOX_API_VERSION: "2025-03-01-preview",
  AUTOX_APPLICATION: "autox-merged-ui",
  LLM_MODEL: "gpt-4.1-mini",
});

const avatarId = "3f0a8a52-6f43-4a53-9d0e-1b6f0c1c2a77";

describe("AutoX client", () => {
  it("posts the Responses API with api-key, username, and application", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { model?: string; stream?: boolean };
      if (body.stream) {
        return sseResponse([
          'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
          'data: {"type":"response.output_text.delta","delta":" there"}\n\n',
          COMPLETED,
        ]);
      }
      return jsonResponse({
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  decision: "propose",
                  reason: "None of the avatars fit.",
                  draft: {
                    name: "Hiring advisor",
                    description: "Weighs a headcount request.",
                    perspective: "Looks at the work the role would do.",
                    voice: "Plain and specific.",
                    caresAbout: ["The work to be done"],
                    createdBy: "user",
                  },
                }),
              },
            ],
          },
        ],
      });
    });

    const model = createAutoxModel(config, fetchImpl as unknown as typeof fetch);
    const decision = await model.classify({
      content: "Should I hire two engineers?",
      summaries: [
        {
          id: avatarId,
          name: "Skeptical CFO",
          description: "Funds only plans with numbers.",
          useWhen: ["Budget requests"],
        },
      ],
    });

    expect(decision.decision).toBe("propose");
    if (decision.decision !== "propose") return;
    expect(decision.draft.name).toBe("Hiring advisor");
    expect(decision.draft.intensity).toBe("balanced");
    expect("createdBy" in decision.draft).toBe(false);

    const deltas: string[] = [];
    for await (const delta of model.streamAnswer({ system: "Be brief.", prompt: "Hello" })) {
      deltas.push(delta);
    }
    expect(deltas).toEqual(["Hello", " there"]);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const calls = fetchImpl.mock.calls;
    expect(calls[0]?.[0]).toBe(responsesUrl(config));
    expect(calls[1]?.[0]).toBe(calls[0]?.[0]);
    for (const call of calls) {
      const init = call[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers).toMatchObject({
        "api-key": "test-key",
        username: "ada",
        application: "autox-merged-ui",
      });
      expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain("authorization");
      const body = JSON.parse(String(init.body)) as {
        model: string;
        input: Array<{ role: string; content: Array<{ type: string; text: string }> }>;
      };
      expect(body.model).toBe("gpt-4.1-mini");
      expect(body.input[0]).toEqual({
        role: "system",
        content: [{ type: "input_text", text: expect.any(String) }],
      });
      expect(body.input[1]?.role).toBe("user");
      expect(body.input[1]?.content[0]?.type).toBe("input_text");
    }
    const answerBody = JSON.parse(String((calls[1]?.[1] as RequestInit).body)) as { stream?: boolean };
    expect(answerBody.stream).toBe(true);
    const classifyBody = JSON.parse(String((calls[0]?.[1] as RequestInit).body)) as { stream?: boolean };
    expect(classifyBody.stream).toBeUndefined();
  });

  it("reads CRLF output-text deltas", async () => {
    const frame =
      'event: response.output_text.delta\r\ndata: {"type":"response.output_text.delta","delta":"Hi"}\r\n\r\n' +
      COMPLETED.replace(/\n/g, "\r\n");
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              const bytes = new TextEncoder().encode(frame);
              controller.enqueue(bytes.slice(0, 10));
              controller.enqueue(bytes.slice(10));
              controller.close();
            },
          }),
          { status: 200 },
        ),
    );
    const model = createAutoxModel(config, fetchImpl as unknown as typeof fetch);
    const deltas: string[] = [];
    for await (const delta of model.streamAnswer({ system: "Be brief.", prompt: "Hello" })) {
      deltas.push(delta);
    }
    expect(deltas).toEqual(["Hi"]);
  });

  it("does not include the key in a provider error", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: "bad key test-key" } }, 401),
    );
    const model = createAutoxModel(config, fetchImpl as unknown as typeof fetch);
    await expect(model.classify({ content: "Hi", summaries: [] })).rejects.toThrow(/Check AUTOX_KEY/);
    await expect(model.classify({ content: "Hi", summaries: [] })).rejects.toThrow(/^(?!.*test-key)/s);
  });

  it("fails a stream that ends without response.completed", async () => {
    const fetchImpl = vi.fn(async () => sseResponse([delta("Hi")]));
    const model = createAutoxModel(config, fetchImpl as unknown as typeof fetch);
    const deltas: string[] = [];
    await expect(async () => {
      for await (const text of model.streamAnswer({ system: "s", prompt: "p" })) deltas.push(text);
    }).rejects.toThrow(/ended the answer stream before it finished/);
    expect(deltas).toEqual(["Hi"]);
  });

  it("explains a connection that drops mid-stream", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(delta("Hi")));
              controller.error(new TypeError("terminated"));
            },
          }),
          { status: 200 },
        ),
    );
    const model = createAutoxModel(config, fetchImpl as unknown as typeof fetch);
    await expect(async () => {
      for await (const _ of model.streamAnswer({ system: "s", prompt: "p" })) void _;
    }).rejects.toThrow("The connection to the provider closed before the answer finished.");
  });

  it("reports response.incomplete with its reason", async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        delta("Hi"),
        'event: response.incomplete\ndata: {"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}\n\n',
      ]),
    );
    const model = createAutoxModel(config, fetchImpl as unknown as typeof fetch);
    await expect(async () => {
      for await (const _ of model.streamAnswer({ system: "s", prompt: "p" })) void _;
    }).rejects.toThrow("The provider stopped the answer before it finished (max_output_tokens).");
  });

  it("times out a classification the provider never answers", async () => {
    const model = createAutoxModel(config, hangingFetch as unknown as typeof fetch, { timeoutMs: 50 });
    await expect(model.classify({ content: "Hi", summaries: [] })).rejects.toThrow(
      "The provider did not respond within 0.05 seconds.",
    );
  });

  it("times out a stream that goes quiet", async () => {
    const fetchImpl = vi.fn(
      async (_url: string, init: RequestInit) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(delta("Hi")));
              init.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
            },
          }),
          { status: 200 },
        ),
    );
    const model = createAutoxModel(config, fetchImpl as unknown as typeof fetch, { timeoutMs: 50 });
    await expect(async () => {
      for await (const _ of model.streamAnswer({ system: "s", prompt: "p" })) void _;
    }).rejects.toThrow(/sent nothing for 0.05 seconds/);
  });

  it("names the host when the provider cannot be reached", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const model = createAutoxModel(config, fetchImpl as unknown as typeof fetch);
    await expect(model.classify({ content: "Hi", summaries: [] })).rejects.toThrow(
      "Could not reach the provider at chat.autox.corp.amdocs.azr.",
    );
  });
});

const COMPLETED = 'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n';

function delta(text: string): string {
  return `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}\n\n`;
}

function hangingFetch(_url: string, init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });
}

describe("extractOutputText", () => {
  it("joins output_text parts", () => {
    expect(
      extractOutputText({
        output: [{ content: [{ type: "output_text", text: "A" }, { type: "output_text", text: "B" }] }],
      }),
    ).toBe("AB");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}
