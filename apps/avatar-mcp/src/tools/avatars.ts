import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  avatarCreateSchema,
  avatarListResponseSchema,
  avatarSchema,
  avatarSummaryListSchema,
  getAvatarInputSchema,
} from "../schemas/avatar.js";
import { AvatarApiError, AvatarClient } from "../services/avatar-api.js";
import type { AvatarCreate, AvatarSummary } from "../types.js";

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export function registerAvatarTools(server: McpServer, client: AvatarClient): void {
  server.registerTool(
    "list_avatars",
    {
      title: "List avatars",
      description:
        "Use when you need to choose an avatar for a question and do not already have an id. Returns only id, name, description, and useWhen for every avatar, so you can match the request before loading a full stance.",
      inputSchema: z.strictObject({}),
      outputSchema: avatarSummaryListSchema,
      annotations: readOnly,
    },
    async () => listAvatars(client),
  );

  server.registerTool(
    "get_avatar",
    {
      title: "Get avatar",
      description:
        "Use when you already have an avatar id and need the full stance — perspective, voice, caresAbout, ignores, and intensity — before answering as that avatar. Pass the id from list_avatars or create_avatar.",
      inputSchema: getAvatarInputSchema,
      outputSchema: avatarSchema,
      annotations: readOnly,
    },
    async ({ avatarId }) => getAvatar(client, avatarId),
  );

  server.registerTool(
    "create_avatar",
    {
      title: "Create avatar",
      description:
        "Use when no existing avatar fits the question and you need to save a new stance. Sends the avatar definition to the avatar service and returns the stored avatar. Do not use this to change or remove an avatar that already exists.",
      inputSchema: avatarCreateSchema,
      outputSchema: avatarSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (body) => createAvatar(client, body),
  );
}

export async function listAvatars(client: AvatarClient): Promise<CallToolResult> {
  return run(async () => {
    const body = await client.listAvatars();
    const parsed = avatarListResponseSchema.safeParse(body);
    if (!parsed.success) {
      return fail("Avatar API returned a list that does not match the contract.");
    }
    const items: AvatarSummary[] = parsed.data.items.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      useWhen: item.useWhen ?? [],
    }));
    return ok({ items });
  });
}

export async function getAvatar(client: AvatarClient, avatarId: string): Promise<CallToolResult> {
  return run(async () => {
    const body = await client.getAvatar(avatarId);
    const parsed = avatarSchema.safeParse(body);
    if (!parsed.success || !isRecord(body)) {
      return fail("Avatar API returned an avatar that does not match the contract.");
    }
    return ok(body);
  });
}

export async function createAvatar(client: AvatarClient, body: AvatarCreate): Promise<CallToolResult> {
  return run(async () => {
    const created = await client.createAvatar(body);
    const parsed = avatarSchema.safeParse(created);
    if (!parsed.success || !isRecord(created)) {
      return fail("Avatar API returned an avatar that does not match the contract.");
    }
    return ok(created);
  });
}

async function run(action: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof AvatarApiError) {
      const message = error.status > 0 ? `HTTP ${error.status}. ${error.message}` : error.message;
      return fail(message);
    }
    console.error(
      "Unexpected avatar tool failure:",
      error instanceof Error ? error.message : "unknown error",
    );
    return fail("The avatar tool failed before it could return a result.");
  }
}

function ok(data: object): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function fail(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
