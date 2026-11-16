import type { Avatar, AvatarCreate } from "@avatars/contracts/avatar";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import type { AssistantModel } from "../src/autox.js";
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
