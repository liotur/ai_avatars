import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createAvatarMcpServer } from "../server.js";
import { AvatarClient } from "../services/avatar-api.js";

const API = "http://localhost:3000/v1";

const skepticalCfo = {
  id: "3f0a8a52-6f43-4a53-9d0e-1b6f0c1c2a77",
  name: "Skeptical CFO",
  description: "A finance chief who funds only the plans that have numbers.",
  perspective: "Reads every proposal as a claim on limited cash.",
  voice: "Dry and brief.",
  caresAbout: ["Cash runway", "Payback period"],
  ignores: ["Vision statements"],
  useWhen: ["Budget requests and business cases"],
  intensity: "balanced",
  createdBy: "user",
  createdAt: "2026-11-16T10:31:00Z",
  updatedAt: "2026-11-16T10:31:00Z",
};

const futureMe = {
  id: "8c9f1f0e-2a51-4d53-b0c7-5d0c8f6f1a11",
  name: "Future me at 80",
  description: "Yourself at eighty, looking back on the decision you face now.",
  perspective: "Judges every choice by how it will look across decades.",
  voice: "Warm and unhurried.",
  caresAbout: ["The people you will still love in forty years"],
  ignores: ["Status and titles"],
  useWhen: ["Big life or career decisions"],
  intensity: "immersive",
  createdBy: "user",
  createdAt: "2026-11-16T10:30:00Z",
  updatedAt: "2026-11-16T10:30:00Z",
};

describe("avatar tools", () => {
  const client = new AvatarClient(API);
  const server = createAvatarMcpServer(client);
  const mcp = new Client({ name: "avatar-mcp-test", version: "0.0.0" });

  beforeAll(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await mcp.connect(clientTransport);
  });

  afterAll(async () => {
    await mcp.close();
    await server.close();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists only the three avatar tools", async () => {
    const listed = await mcp.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
      "create_avatar",
      "get_avatar",
      "list_avatars",
    ]);
  });

  it("list_avatars projects each avatar to id, name, description, and useWhen", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [skepticalCfo, futureMe] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await mcp.callTool({ name: "list_avatars", arguments: {} });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API}/avatars`);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
    expect(result.structuredContent).toEqual({
      items: [
        {
          id: skepticalCfo.id,
          name: skepticalCfo.name,
          description: skepticalCfo.description,
          useWhen: skepticalCfo.useWhen,
        },
        {
          id: futureMe.id,
          name: futureMe.name,
          description: futureMe.description,
          useWhen: futureMe.useWhen,
        },
      ],
    });
    const text = textOf(result);
    expect(text).not.toContain("perspective");
    expect(text).not.toContain("Cash runway");
    expect(text).not.toContain("createdAt");
  });

  it("get_avatar forwards the id on the avatar path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(skepticalCfo));
    vi.stubGlobal("fetch", fetchMock);

    const result = await mcp.callTool({
      name: "get_avatar",
      arguments: { avatarId: skepticalCfo.id },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API}/avatars/${skepticalCfo.id}`);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
    expect(result.structuredContent).toEqual(skepticalCfo);
    expect(result.isError).toBeUndefined();
  });

  it("create_avatar posts the avatar body", async () => {
    const draft = {
      name: "Future me at 80",
      description: "Yourself at eighty, looking back on the decision you face now.",
      perspective: "Judges every choice by how it will look across decades.",
      voice: "Warm and unhurried. Speaks as we.",
      caresAbout: ["The people you will still love in forty years"],
      ignores: ["Status and titles"],
      useWhen: ["Big life or career decisions"],
      intensity: "immersive" as const,
      createdBy: "assistant" as const,
    };
    const created = { ...futureMe, ...draft, id: futureMe.id };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(created, 201));
    vi.stubGlobal("fetch", fetchMock);

    const result = await mcp.callTool({ name: "create_avatar", arguments: draft });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${API}/avatars`);
    expect(init).toMatchObject({ method: "POST" });
    const requestInit = init as RequestInit;
    expect(requestInit.headers).toMatchObject({ "content-type": "application/json" });
    expect(JSON.parse(String(requestInit.body))).toEqual(draft);
    expect(result.structuredContent).toEqual(created);
  });

  it("returns the problem detail as a tool error", async () => {
    const detail = `No avatar with id ${skepticalCfo.id}.`;
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          type: "https://avatar.local/problems/avatar-not-found",
          title: "Avatar not found",
          status: 404,
          detail,
        },
        404,
        "application/problem+json",
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await mcp.callTool({
      name: "get_avatar",
      arguments: { avatarId: skepticalCfo.id },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(`HTTP 404. ${detail}`);
    expect(textOf(result)).not.toContain("AvatarApiError");
    expect(textOf(result)).not.toContain(".ts");
  });

  it("includes field errors after the problem detail when validation fails", async () => {
    const detail = "1 field is invalid.";
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          type: "https://avatar.local/problems/validation-failed",
          title: "Request validation failed",
          status: 400,
          detail,
          errors: [{ field: "/caresAbout", message: "must contain at least 1 item" }],
        },
        400,
        "application/problem+json",
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await mcp.callTool({
      name: "create_avatar",
      arguments: {
        name: "Skeptical CFO",
        description: "A finance chief.",
        perspective: "Looks at the cash first.",
        voice: "Dry and brief.",
        caresAbout: ["Cash runway"],
      },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(`HTTP 400. ${detail}\n/caresAbout: must contain at least 1 item`);
  });
});

function jsonResponse(body: unknown, status = 200, contentType = "application/json"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": contentType },
  });
}

type ToolCall = Awaited<ReturnType<Client["callTool"]>>;

function textOf(result: ToolCall): string {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    throw new Error("expected text content");
  }
  const block: unknown = content[0];
  if (!isTextBlock(block)) {
    throw new Error("expected text content");
  }
  return block.text;
}

function isTextBlock(value: unknown): value is { type: "text"; text: string } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.type === "text" && typeof record.text === "string";
}
