import type { Avatar, AvatarCreate } from "@avatars/contracts/avatar";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { ClassificationRejectedError, type AssistantModel, type ClassifyInput } from "../src/model.js";
import type { Classification } from "../src/classify.js";
import { AvatarRejectedError, type AvatarMcp, type AvatarSummary } from "../src/mcp.js";

const CFO_ID = "3f0a8a52-6f43-4a53-9d0e-1b6f0c1c2a77";
const NEW_ID = "8c9f1f0e-2a51-4d53-b0c7-5d0c8f6f1a11";
const MISSING_ID = "0b6e2f7a-3c1d-4e5f-8a9b-1c2d3e4f5a6b";

const summary: AvatarSummary = {
  id: CFO_ID,
  name: "Skeptical CFO",
  description: "A finance chief who funds only plans with numbers.",
  useWhen: ["Budget requests and business cases"],
};

function avatar(overrides: Partial<Avatar> = {}): Avatar {
  return {
    id: CFO_ID,
    name: "Skeptical CFO",
    description: summary.description,
    perspective: "Reads every proposal as a claim on limited cash.",
    voice: "Dry and brief.",
    caresAbout: ["Cash runway", "Payback period"],
    ignores: ["Vision statements"],
    useWhen: summary.useWhen,
    intensity: "balanced",
    createdBy: "user",
    createdAt: "2026-11-16T10:31:00Z",
    updatedAt: "2026-11-16T10:31:00Z",
    ...overrides,
  };
}

const draft = {
  name: "Hiring advisor",
  description: "Weighs a request to add people.",
  perspective: "Looks at the work the role would do.",
  voice: "Plain and specific.",
  caresAbout: ["The work to be done"],
  ignores: [] as string[],
  useWhen: ["Hiring decisions"],
  intensity: "balanced" as const,
};

function mcp(overrides: Partial<AvatarMcp> = {}): AvatarMcp {
  const stored = new Map<string, Avatar>([[CFO_ID, avatar()]]);
  const base: AvatarMcp = {
    listAvatars: vi.fn(async () => [summary]),
    getAvatar: vi.fn(async (id: string) => stored.get(id) ?? avatar({ id })),
    createAvatar: vi.fn(async (body: AvatarCreate) => {
      const created = avatar({
        id: NEW_ID,
        name: body.name,
        description: body.description,
        perspective: body.perspective,
        voice: body.voice,
        caresAbout: body.caresAbout,
        ignores: body.ignores ?? [],
        useWhen: body.useWhen ?? [],
        intensity: body.intensity ?? "balanced",
        createdBy: body.createdBy ?? "user",
      });
      stored.set(created.id, created);
      return created;
    }),
  };
  return { ...base, ...overrides };
}

function model(overrides: Partial<AssistantModel> = {}): AssistantModel {
  return {
    classify: vi.fn(async () => ({
      decision: "choose",
      avatarId: CFO_ID,
      reason: "A hiring budget request is a business case.",
    }) satisfies Classification),
    streamAnswer: async function* () {
      yield "Two engineers cost about $400k a year loaded. ";
      yield "What do they ship?";
    },
    evaluate: vi.fn(async () => ({ checks: { answers: true, sound: true, stance: true, voice: true }, advice: "" })),
    ...overrides,
  };
}

async function openSession(app: ReturnType<typeof createApp>): Promise<string> {
  const response = await app.request("/v1/sessions", { method: "POST" });
  expect(response.status).toBe(201);
  expect(response.headers.get("location")).toMatch(/^\/v1\/sessions\/[0-9a-f-]{36}$/);
  const body = (await response.json()) as { id: string; createdAt: string };
  expect(body.id).toBeTruthy();
  expect(body.createdAt).toBeTruthy();
  return body.id;
}

function sseEvents(body: string): Array<{ event: string; data: unknown }> {
  return body
    .trim()
    .split(/\n\n+/)
    .filter((block) => block.trim())
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (!event || !data) throw new Error(`Unparsed SSE block: ${block}`);
      return { event, data: JSON.parse(data) as unknown };
    });
}

describe("assistant HTTP", () => {
  it("reports health", async () => {
    const app = createApp({ mcp: mcp(), model: model() });
    const response = await app.request("/v1/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("reports whether it can answer", async () => {
    const ready = createApp({ mcp: mcp(), model: model(), status: { ready: true, provider: "gemini", model: "gemini-flash-latest" } });
    expect(await (await ready.request("/v1/assistant")).json()).toEqual({
      ready: true,
      provider: "gemini",
      model: "gemini-flash-latest",
    });

    const unset = createApp({ mcp: mcp(), status: { ready: false, detail: "Put LLM_API_KEY in the .env file." } });
    expect(await (await unset.request("/v1/assistant")).json()).toEqual({
      ready: false,
      detail: "Put LLM_API_KEY in the .env file.",
    });
  });

  it("opens a session without a model, and refuses a message with 503 and the reason", async () => {
    const tools = mcp();
    const app = createApp({ mcp: tools, status: { ready: false, detail: "Put LLM_API_KEY in the .env file." } });
    const sessionId = await openSession(app);

    const response = await app.request(`/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Hello" }),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(await response.json()).toEqual({
      type: "https://assistant.local/problems/llm-not-configured",
      title: "Language model is not configured",
      status: 503,
      detail: "Put LLM_API_KEY in the .env file.",
    });
    expect(tools.listAvatars).not.toHaveBeenCalled();
  });

  it("answers an unknown route with problem+json", async () => {
    const app = createApp({ mcp: mcp(), model: model() });
    const response = await app.request("/v1/nope");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(await response.json()).toMatchObject({ status: 404, title: "Not found" });
  });

  it("chooses an avatar and streams avatar, delta, and done", async () => {
    const tools = mcp();
    const language = model();
    const app = createApp({ mcp: tools, model: language });
    const sessionId = await openSession(app);

    const response = await app.request(`/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Should I hire two engineers next quarter?" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = sseEvents(await response.text());
    expect(events.map((event) => event.event)).toEqual(["avatar", "delta", "delta", "done"]);
    expect(events[0]?.data).toEqual({
      avatar: {
        id: CFO_ID,
        name: "Skeptical CFO",
        description: summary.description,
        intensity: "balanced",
        createdBy: "user",
      },
      selection: { mode: "chosen", reason: "A hiring budget request is a business case." },
    });
    expect(events[1]?.data).toEqual({ text: "Two engineers cost about $400k a year loaded. " });
    expect(events[3]?.data).toMatchObject({ id: expect.any(String), createdAt: expect.any(String) });
    expect(tools.createAvatar).not.toHaveBeenCalled();
    expect(tools.getAvatar).toHaveBeenCalledWith(CFO_ID);
  });

  it("saves a proposed avatar with createdBy assistant", async () => {
    const tools = mcp();
    const language = model({
      classify: vi.fn(async (): Promise<Classification> => ({
        decision: "propose",
        reason: "No avatar is meant for hiring plans.",
        draft,
      })),
    });
    const app = createApp({ mcp: tools, model: language });
    const sessionId = await openSession(app);

    const response = await app.request(`/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Should I hire two engineers?" }),
    });

    expect(response.status).toBe(200);
    const events = sseEvents(await response.text());
    expect(events.map((event) => event.event)).toContain("avatar");
    expect(events.map((event) => event.event)).toContain("delta");
    expect(events.map((event) => event.event)).toContain("done");
    expect(events[0]?.data).toMatchObject({
      avatar: { id: NEW_ID, createdBy: "assistant", name: "Hiring advisor" },
      selection: { mode: "created", reason: "No avatar is meant for hiring plans." },
    });
    expect(tools.createAvatar).toHaveBeenCalledWith({ ...draft, createdBy: "assistant" });
    expect(language.classify).toHaveBeenCalledTimes(1);
  });

  it("uses a requested avatar and skips classification", async () => {
    const tools = mcp();
    const language = model();
    const app = createApp({ mcp: tools, model: language });
    const sessionId = await openSession(app);

    const response = await app.request(`/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Should I take the job?", avatarId: CFO_ID }),
    });

    expect(response.status).toBe(200);
    const events = sseEvents(await response.text());
    expect(events[0]?.data).toMatchObject({
      selection: { mode: "requested" },
      avatar: { id: CFO_ID },
    });
    expect(JSON.stringify(events[0]?.data)).not.toContain("reason");
    expect(language.classify).not.toHaveBeenCalled();
    expect(tools.createAvatar).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown session without calling MCP", async () => {
    const tools = mcp();
    const app = createApp({ mcp: tools, model: model() });
    const response = await app.request(`/v1/sessions/${MISSING_ID}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Hello" }),
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(await response.json()).toMatchObject({
      type: "https://assistant.local/problems/session-not-found",
      status: 404,
    });
    expect(tools.listAvatars).not.toHaveBeenCalled();
  });

  it("returns 404 when the requested avatar is missing", async () => {
    const tools = mcp();
    const language = model();
    const app = createApp({ mcp: tools, model: language });
    const sessionId = await openSession(app);
    const response = await app.request(`/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Hello", avatarId: MISSING_ID }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      type: "https://assistant.local/problems/avatar-not-found",
      status: 404,
    });
    expect(language.classify).not.toHaveBeenCalled();
  });

  it("retries once when the model picks an unknown id", async () => {
    const classify = vi
      .fn<() => Promise<Classification>>()
      .mockResolvedValueOnce({
        decision: "choose",
        avatarId: MISSING_ID,
        reason: "Guessing.",
      })
      .mockResolvedValueOnce({
        decision: "choose",
        avatarId: CFO_ID,
        reason: "The list has a finance avatar.",
      });
    const tools = mcp();
    const app = createApp({ mcp: tools, model: model({ classify }) });
    const sessionId = await openSession(app);
    const response = await app.request(`/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Is this budget sound?" }),
    });
    expect(response.status).toBe(200);
    expect(classify).toHaveBeenCalledTimes(2);
    const second = classify.mock.calls[1] as unknown as [unknown] | undefined;
    expect(JSON.stringify(second)).toContain(MISSING_ID);
    const events = sseEvents(await response.text());
    expect(events[0]?.data).toMatchObject({ selection: { mode: "chosen" } });
  });

  it("retries once when the model's reply breaks a limit, and says which", async () => {
    const classify = vi
      .fn<() => Promise<Classification>>()
      .mockRejectedValueOnce(
        new ClassificationRejectedError(
          "The model returned a classification that does not match the expected shape. draft.description: Too big: expected string to have <=280 characters",
        ),
      )
      .mockResolvedValueOnce({ decision: "propose", reason: "None fit.", draft });
    const tools = mcp();
    const app = createApp({ mcp: tools, model: model({ classify }) });
    const sessionId = await openSession(app);
    const response = await app.request(`/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Should I move to Berlin for a job?" }),
    });
    expect(response.status).toBe(200);
    expect(classify).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(classify.mock.calls[1])).toContain("draft.description: Too big");
    expect(tools.createAvatar).toHaveBeenCalledTimes(1);
    const events = sseEvents(await response.text());
    expect(events[0]?.data).toMatchObject({ selection: { mode: "created" } });
  });

  it("returns 502 with the reason when the model's reply is unusable twice", async () => {
    const classify = vi
      .fn<() => Promise<Classification>>()
      .mockRejectedValue(new ClassificationRejectedError("The model did not return JSON."));
    const tools = mcp();
    const app = createApp({ mcp: tools, model: model({ classify }) });
    const sessionId = await openSession(app);
    const response = await app.request(`/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Hello" }),
    });
    expect(response.status).toBe(502);
    expect(classify).toHaveBeenCalledTimes(2);
    expect(await response.json()).toMatchObject({
      type: "https://assistant.local/problems/llm-failed",
      detail: "The model returned an unusable classification after one retry. The model did not return JSON.",
    });
    expect(tools.createAvatar).not.toHaveBeenCalled();
  });

  it("never lets a raw schema error out when a draft is out of limits", async () => {
    const tooLong = { ...draft, description: "d".repeat(281) };
    const classify = vi.fn(async (): Promise<Classification> => ({ decision: "propose", reason: "None fit.", draft: tooLong }));
    const tools = mcp();
    const app = createApp({ mcp: tools, model: model({ classify }) });
    const sessionId = await openSession(app);
    const response = await app.request(`/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Hello" }),
    });
    expect(response.status).toBe(502);
    expect(classify).toHaveBeenCalledTimes(2);
    const body = (await response.json()) as { detail: string };
    expect(body.detail).toContain("The draft is not usable. description:");
    expect(body.detail).not.toContain("too_big");
    expect(tools.createAvatar).not.toHaveBeenCalled();
  });

  it("retries a rejected draft once, then returns 502", async () => {
    const createAvatar = vi
      .fn()
      .mockRejectedValueOnce(new AvatarRejectedError(409, 'An avatar named "Hiring advisor" already exists.'))
      .mockRejectedValueOnce(new AvatarRejectedError(409, 'An avatar named "Hiring advisor" already exists.'));
    const tools = mcp({ createAvatar });
    const app = createApp({
      mcp: tools,
      model: model({
        classify: vi.fn(async (): Promise<Classification> => ({ decision: "propose", reason: "None fit.", draft })),
      }),
    });
    const sessionId = await openSession(app);
    const response = await app.request(`/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Should I hire?" }),
    });
    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(await response.json()).toMatchObject({
      type: "https://assistant.local/problems/llm-failed",
      status: 502,
    });
    expect(createAvatar).toHaveBeenCalledTimes(2);
    expect(createAvatar).toHaveBeenCalledWith(expect.objectContaining({ createdBy: "assistant" }));
  });

  it("remembers the conversation: the next message is classified and answered with the earlier turn", async () => {
    const classify = vi.fn(
      async (_input: ClassifyInput): Promise<Classification> => ({ decision: "choose", avatarId: CFO_ID, reason: "A budget question." }),
    );
    const seen: Array<{ prompt: string; history: unknown }> = [];
    const language = model({
      classify,
      streamAnswer: async function* (input) {
        seen.push({ prompt: input.prompt, history: input.history });
        yield seen.length === 1 ? "Show me " : "The second point ";
        yield seen.length === 1 ? "the payback." : "is cash.";
      },
    });
    const app = createApp({ mcp: mcp(), model: language });
    const sessionId = await openSession(app);
    const send = async (content: string) => {
      const response = await app.request(`/v1/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      expect(response.status).toBe(200);
      await response.text();
    };

    await send("Can we afford two hires?");
    await send("And the second point?");

    // The first message had nothing before it.
    expect(classify.mock.calls[0]?.[0]).not.toHaveProperty("history");
    expect(seen[0]).toEqual({ prompt: "Can we afford two hires?", history: [] });

    // The second is shown the first exchange, by both calls.
    expect(classify.mock.calls[1]?.[0]).toMatchObject({
      content: "And the second point?",
      history: [
        {
          question: "Can we afford two hires?",
          answeredBy: { id: CFO_ID, name: "Skeptical CFO" },
          answer: "Show me the payback.",
        },
      ],
    });
    expect(seen[1]).toEqual({
      prompt: "And the second point?",
      history: [
        { role: "user", content: "Can we afford two hires?" },
        { role: "assistant", content: "Show me the payback." },
      ],
    });
  });

  it("keeps each chat's memory to itself", async () => {
    const histories: unknown[] = [];
    const language = model({
      streamAnswer: async function* (input) {
        histories.push(input.history);
        yield "An answer.";
      },
    });
    const app = createApp({ mcp: mcp(), model: language });
    const first = await openSession(app);
    const second = await openSession(app);
    for (const sessionId of [first, second]) {
      const response = await app.request(`/v1/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "Hello" }),
      });
      await response.text();
    }
    expect(histories).toEqual([[], []]);
  });

  it("remembers the part of an answer that arrived before it failed, once", async () => {
    let calls = 0;
    const histories: unknown[] = [];
    const language = model({
      streamAnswer: async function* (input) {
        calls += 1;
        histories.push(input.history);
        yield "Half an ";
        if (calls === 1) throw new Error("The provider stopped.");
        yield "answer.";
      },
    });
    const app = createApp({ mcp: mcp(), model: language });
    const sessionId = await openSession(app);
    for (const content of ["First question", "Second question", "Third question"]) {
      const response = await app.request(`/v1/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      await response.text();
    }
    expect(histories[1]).toEqual([
      { role: "user", content: "First question" },
      { role: "assistant", content: "Half an " },
    ]);
    // Each exchange is recorded once, in order.
    expect(histories[2]).toEqual([
      { role: "user", content: "First question" },
      { role: "assistant", content: "Half an " },
      { role: "user", content: "Second question" },
      { role: "assistant", content: "Half an answer." },
    ]);
  });

  it("tells the answering avatar when another avatar answered earlier", async () => {
    const systems: string[] = [];
    const language = model({
      classify: vi
        .fn<() => Promise<Classification>>()
        .mockResolvedValueOnce({ decision: "choose", avatarId: CFO_ID, reason: "A budget question." })
        .mockResolvedValueOnce({ decision: "propose", reason: "None fit.", draft }),
      streamAnswer: async function* (input) {
        systems.push(input.system);
        yield "An answer.";
      },
    });
    const app = createApp({ mcp: mcp(), model: language });
    const sessionId = await openSession(app);
    for (const content of ["Can we afford two hires?", "Now, who should we hire?"]) {
      const response = await app.request(`/v1/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      await response.text();
    }
    expect(systems[0]).not.toContain("other stances");
    expect(systems[1]).toContain("Some earlier answers in this conversation were given from other stances.");
  });

  describe("with the answer check on", () => {
    const ask = async (app: ReturnType<typeof createApp>, content = "Should I hire two engineers?") => {
      const sessionId = await openSession(app);
      const response = await app.request(`/v1/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      expect(response.status).toBe(200);
      return sseEvents(await response.text());
    };
    const failing = (checks: Partial<Record<"answers" | "sound" | "stance" | "voice", boolean>>, advice = "") => ({
      checks: { answers: true, sound: true, stance: true, voice: true, ...checks },
      advice,
    });

    it("holds the draft back, checks it, and shows it when it passes", async () => {
      const language = model();
      const events = await ask(createApp({ mcp: mcp(), model: language, checkAnswers: true }));

      expect(events.map((event) => event.event)).toEqual(["avatar", "stage", "stage", "evaluation", "delta", "done"]);
      expect(events[1]?.data).toEqual({ stage: "drafting" });
      expect(events[2]?.data).toEqual({ stage: "checking" });
      expect(events[3]?.data).toEqual({ verdict: "passed", failed: [] });
      expect(events[4]?.data).toEqual({ text: "Two engineers cost about $400k a year loaded. What do they ship?" });
      expect(language.evaluate).toHaveBeenCalledTimes(1);
      expect(vi.mocked(language.evaluate).mock.calls[0]?.[0]).toMatchObject({
        content: "Should I hire two engineers?",
        draft: "Two engineers cost about $400k a year loaded. What do they ship?",
        avatar: { name: "Skeptical CFO" },
      });
    });

    it("has the avatar rewrite a draft that fails, once, and shows the rewrite as it is written", async () => {
      const calls: Array<{ prompt: string; history: unknown }> = [];
      const language = model({
        evaluate: vi.fn(async () => failing({ stance: false }, "Lead with the cash runway.")),
        streamAnswer: async function* (input) {
          calls.push({ prompt: input.prompt, history: input.history });
          if (calls.length === 1) {
            yield "A vague first draft.";
          } else {
            yield "Runway first: ";
            yield "you have nine months.";
          }
        },
      });
      const app = createApp({ mcp: mcp(), model: language, checkAnswers: true });
      const events = await ask(app);

      expect(events.map((event) => event.event)).toEqual([
        "avatar",
        "stage",
        "stage",
        "evaluation",
        "stage",
        "delta",
        "delta",
        "done",
      ]);
      expect(events[3]?.data).toEqual({ verdict: "revised", failed: ["stance"], note: "Lead with the cash runway." });
      expect(events[4]?.data).toEqual({ stage: "revising" });
      expect(events[5]?.data).toEqual({ text: "Runway first: " });
      // The draft is never sent to the person.
      expect(JSON.stringify(events)).not.toContain("A vague first draft.");
      // The rewrite is asked for after the draft, with the advice, and is not checked again.
      expect(calls[1]?.history).toEqual([
        { role: "user", content: "Should I hire two engineers?" },
        { role: "assistant", content: "A vague first draft." },
      ]);
      expect(calls[1]?.prompt).toContain("Lead with the cash runway.");
      expect(language.evaluate).toHaveBeenCalledTimes(1);
    });

    it("remembers the answer the person saw, not the rejected draft", async () => {
      const histories: unknown[] = [];
      let answers = 0;
      const language = model({
        evaluate: vi
          .fn()
          .mockResolvedValueOnce(failing({ answers: false }, "Answer the question."))
          .mockResolvedValue(failing({})),
        streamAnswer: async function* (input) {
          histories.push(input.history);
          answers += 1;
          yield answers === 1 ? "Draft." : answers === 2 ? "The real answer." : "A follow-up answer.";
        },
      });
      const app = createApp({ mcp: mcp(), model: language, checkAnswers: true });
      const sessionId = await openSession(app);
      for (const content of ["First question", "Second question"]) {
        const response = await app.request(`/v1/sessions/${sessionId}/messages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content }),
        });
        await response.text();
      }
      expect(histories[2]).toEqual([
        { role: "user", content: "First question" },
        { role: "assistant", content: "The real answer." },
      ]);
    });

    it("shows the draft, labelled as unchecked, when the check itself cannot run", async () => {
      const language = model({
        evaluate: vi.fn(async () => {
          throw new Error("The check returned a reply that could not be used.");
        }),
      });
      const events = await ask(createApp({ mcp: mcp(), model: language, checkAnswers: true }));
      expect(events.map((event) => event.event)).toEqual(["avatar", "stage", "stage", "evaluation", "delta", "done"]);
      expect(events[3]?.data).toEqual({
        verdict: "skipped",
        failed: [],
        note: "The check could not be run, so this answer is shown unchecked.",
      });
    });

    it("sends an error and shows nothing when the draft cannot be written", async () => {
      const language = model({
        streamAnswer: async function* () {
          yield "Half a ";
          throw new Error("The provider stopped.");
        },
      });
      const events = await ask(createApp({ mcp: mcp(), model: language, checkAnswers: true }));
      expect(events.map((event) => event.event)).toEqual(["avatar", "stage", "error"]);
      expect(language.evaluate).not.toHaveBeenCalled();
    });

    it("leaves the flow as it was when the check is off", async () => {
      const language = model();
      const events = await ask(createApp({ mcp: mcp(), model: language }));
      expect(events.map((event) => event.event)).toEqual(["avatar", "delta", "delta", "done"]);
      expect(language.evaluate).not.toHaveBeenCalled();
    });
  });

  it("removes the key from an error that reaches the person mid-answer", async () => {
    const key = "secret-key-123";
    const app = createApp({
      mcp: mcp(),
      apiKey: key,
      model: model({
        streamAnswer: async function* () {
          yield "Two engineers ";
          throw new Error(`boom ${key}`);
        },
      }),
    });
    const sessionId = await openSession(app);
    const response = await app.request(`/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Should I hire?" }),
    });
    const text = await response.text();
    expect(text).not.toContain(key);
    const events = sseEvents(text);
    expect(events.at(-1)).toMatchObject({ event: "error", data: { detail: "boom [redacted]" } });
  });

  it("sends an error event when the answer stream fails", async () => {
    const app = createApp({
      mcp: mcp(),
      model: model({
        streamAnswer: async function* () {
          yield "Partial. ";
          throw new Error("provider disconnected");
        },
      }),
    });
    const sessionId = await openSession(app);
    const response = await app.request(`/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Hello" }),
    });
    expect(response.status).toBe(200);
    const events = sseEvents(await response.text());
    expect(events.map((event) => event.event)).toEqual(["avatar", "delta", "error"]);
    expect(events[2]?.data).toMatchObject({
      type: "https://assistant.local/problems/llm-failed",
      status: 502,
    });
  });
});
