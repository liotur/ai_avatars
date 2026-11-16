import type { Avatar, AvatarCreate } from "@avatars/contracts/avatar";
import { zAvatar } from "@avatars/contracts/avatar/zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

const TOOL_TIMEOUT_MS = 10_000;

export type AvatarSummary = {
  id: string;
  name: string;
  description: string;
  useWhen: string[];
};

export interface AvatarMcp {
  listAvatars(): Promise<AvatarSummary[]>;
  getAvatar(avatarId: string): Promise<Avatar>;
  createAvatar(body: AvatarCreate): Promise<Avatar>;
}

export class AvatarNotFoundError extends Error {
  constructor(readonly avatarId: string) {
    super(`No avatar with id ${avatarId}.`);
    this.name = "AvatarNotFoundError";
  }
}

export class AvatarRejectedError extends Error {
  constructor(
    readonly status: 400 | 409,
    detail: string,
  ) {
    super(detail);
    this.name = "AvatarRejectedError";
  }
}

export class McpCallError extends Error {
  constructor(
    readonly tool: string,
    detail: string,
  ) {
    super(detail);
    this.name = "McpCallError";
  }
}

const summarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  useWhen: z.array(z.string()).optional().default([]),
});

const summaryListSchema = z.object({
  items: z.array(summarySchema),
});

type ToolResult = {
  content?: unknown;
  structuredContent?: unknown;
  isError?: boolean;
  toolResult?: unknown;
};

/**
 * Streamable HTTP client for avatar-mcp. `get_avatar` takes `{ avatarId }`.
 * `list_avatars` returns `{ items }`. `create_avatar` takes an AvatarCreate body.
 * Tool failures come back as `isError` text (the HTTP status is not included),
 * so 400 and 409 are recognized from the avatar service's problem detail.
 */
export function createAvatarMcp(url: string): AvatarMcp {
  let pending: Promise<Client> | undefined;

  const connect = async (): Promise<Client> => {
    const client = new Client({ name: "assistant", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(url));
    await client.connect(transport);
    return client;
  };

  const getClient = async (): Promise<Client> => {
    if (!pending) pending = connect();
    try {
      return await pending;
    } catch (error) {
      pending = undefined;
      throw error;
    }
  };

  const call = async (name: string, args: Record<string, unknown>, avatarId?: string): Promise<unknown> => {
    try {
      const client = await getClient();
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: TOOL_TIMEOUT_MS });
      return interpretToolResult(name, result, avatarId);
    } catch (error) {
      if (error instanceof AvatarNotFoundError || error instanceof AvatarRejectedError || error instanceof McpCallError) {
        throw error;
      }
      pending = undefined;
      throw new McpCallError(name, transportMessage(name, error, url));
    }
  };

  return {
    listAvatars: async () => {
      const data = await call("list_avatars", {});
      const parsed = summaryListSchema.safeParse(data);
      if (!parsed.success) {
        throw new McpCallError("list_avatars", "list_avatars returned an unexpected payload.");
      }
      return parsed.data.items;
    },
    getAvatar: async (avatarId) => {
      const data = await call("get_avatar", { avatarId }, avatarId);
      return parseAvatar(data, "get_avatar");
    },
    createAvatar: async (body) => {
      const data = await call("create_avatar", { ...body });
      return parseAvatar(data, "create_avatar");
    },
  };
}

export function transportMessage(tool: string, error: unknown, url: string): string {
  const message = error instanceof Error ? error.message : "";
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|socket hang up/i.test(message)) {
    return `${tool} failed. Could not reach the avatar MCP server at ${url}.`;
  }
  if (/timed out|timeout/i.test(message)) {
    return `${tool} did not respond within ${TOOL_TIMEOUT_MS / 1000} seconds.`;
  }
  return message ? `${tool} failed. ${message}` : `${tool} failed.`;
}

export function interpretToolResult(tool: string, result: ToolResult, avatarId?: string): unknown {
  if (result.isError) {
    throw errorFromToolText(tool, textOf(result), avatarId);
  }
  if (result.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }
  if (result.toolResult && typeof result.toolResult === "object") {
    return result.toolResult;
  }
  const text = textOf(result);
  if (!text) {
    throw new McpCallError(tool, `${tool} returned an empty result.`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new McpCallError(tool, `${tool} returned a result that was not JSON.`);
  }
}

export function errorFromToolText(tool: string, text: string, avatarId?: string): Error {
  const detail = text.trim() || `${tool} failed`;
  const status = statusFromText(detail);

  if (tool === "get_avatar") {
    if (status === 404 || /no avatar with id/i.test(detail) || /\bnot found\b/i.test(detail)) {
      return new AvatarNotFoundError(avatarId ?? idFromDetail(detail) ?? "unknown");
    }
    return new McpCallError(tool, detail);
  }

  if (tool === "create_avatar") {
    const rejection = rejectionStatus(detail, status);
    if (rejection) return new AvatarRejectedError(rejection, detail);
    return new McpCallError(tool, detail);
  }

  return new McpCallError(tool, detail);
}

function rejectionStatus(detail: string, status: number | undefined): 400 | 409 | undefined {
  if (status === 409 || /already exists|name already in use/i.test(detail)) return 409;
  if (status === 400) return 400;
  if (status !== undefined && status !== 400 && status !== 409) return undefined;
  // "Input validation error" is how the MCP server reports arguments that break a tool's input schema.
  if (
    /input validation error|field is invalid|is not allowed|must contain|must not|items must be unique|validation failed/i.test(
      detail,
    )
  ) {
    return 400;
  }
  return undefined;
}

function statusFromText(text: string): number | undefined {
  const http = /\bHTTP (\d{3})\b/.exec(text);
  if (http?.[1]) return Number(http[1]);
  try {
    const parsed = JSON.parse(text) as { status?: unknown };
    if (parsed && typeof parsed === "object" && typeof parsed.status === "number") return parsed.status;
  } catch {
    // The avatar MCP returns the problem detail, not the problem JSON.
  }
  const embedded = /"status"\s*:\s*(\d{3})/.exec(text);
  if (embedded?.[1]) return Number(embedded[1]);
  return undefined;
}

function idFromDetail(detail: string): string | undefined {
  const match = /No avatar with id ([0-9a-fA-F-]{36})/.exec(detail);
  return match?.[1];
}

function parseAvatar(data: unknown, tool: string): Avatar {
  const parsed = zAvatar.safeParse(data);
  if (!parsed.success) {
    throw new McpCallError(tool, `${tool} returned an avatar that does not match the contract.`);
  }
  return parsed.data;
}

function textOf(result: ToolResult): string {
  if (!Array.isArray(result.content)) return "";
  const parts: string[] = [];
  for (const block of result.content) {
    if (isTextBlock(block)) parts.push(block.text);
  }
  return parts.join("\n");
}

function isTextBlock(value: unknown): value is { type: "text"; text: string } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.type === "text" && typeof record.text === "string";
}
