import { describe, expect, it } from "vitest";

import { errorFromToolText, interpretToolResult, transportMessage } from "../src/mcp.js";

const avatar = {
  id: "3f0a8a52-6f43-4a53-9d0e-1b6f0c1c2a77",
  name: "Skeptical CFO",
  description: "A finance chief who funds only plans with numbers.",
  perspective: "Reads every proposal as a claim on limited cash.",
  voice: "Dry and brief.",
  caresAbout: ["Cash runway"],
  ignores: ["Vision statements"],
  useWhen: ["Budget requests"],
  intensity: "balanced",
  createdBy: "user",
  createdAt: "2026-11-16T10:31:00Z",
  updatedAt: "2026-11-16T10:31:00Z",
};

describe("MCP tool results", () => {
  it("reads structured summaries and avatars", () => {
    expect(
      interpretToolResult("list_avatars", {
        structuredContent: {
          items: [{ id: avatar.id, name: avatar.name, description: avatar.description, useWhen: avatar.useWhen }],
        },
      }),
    ).toEqual({
      items: [{ id: avatar.id, name: avatar.name, description: avatar.description, useWhen: avatar.useWhen }],
    });
    expect(interpretToolResult("get_avatar", { structuredContent: avatar })).toEqual(avatar);
  });

  it("maps avatar-mcp error text to not-found and rejected drafts", () => {
    expect(errorFromToolText("get_avatar", `No avatar with id ${avatar.id}.`, avatar.id)).toMatchObject({
      name: "AvatarNotFoundError",
      avatarId: avatar.id,
    });
    expect(errorFromToolText("create_avatar", "1 field is invalid.\n/caresAbout: must contain at least 1 item")).toMatchObject({
      name: "AvatarRejectedError",
      status: 400,
    });
    expect(errorFromToolText("create_avatar", 'An avatar named "Skeptical CFO" already exists.')).toMatchObject({
      name: "AvatarRejectedError",
      status: 409,
    });
    expect(errorFromToolText("list_avatars", "Could not reach the avatar API.")).toMatchObject({
      name: "McpCallError",
    });
  });
});

describe("transportMessage", () => {
  it("says the MCP server could not be reached instead of 'fetch failed'", () => {
    expect(transportMessage("list_avatars", new TypeError("fetch failed"), "http://localhost:3001/mcp")).toBe(
      "list_avatars failed. Could not reach the avatar MCP server at http://localhost:3001/mcp.",
    );
  });
});
