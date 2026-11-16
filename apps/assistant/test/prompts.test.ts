import type { Avatar } from "@avatars/contracts/avatar";
import { describe, expect, it } from "vitest";

import { buildAvatarSystemPrompt } from "../src/prompts.js";

const avatar: Avatar = {
  id: "3f0a8a52-6f43-4a53-9d0e-1b6f0c1c2a77",
  name: "Skeptical CFO",
  description: "A finance chief who funds only plans with numbers.",
  perspective: "Reads every proposal as a claim on limited cash.",
  voice: "VOICE-DRY-AND-BRIEF",
  caresAbout: ["Cash runway", "Payback period"],
  ignores: ["Vision statements"],
  useWhen: ["Budget requests"],
  intensity: "subtle",
  createdBy: "user",
  createdAt: "2026-11-16T10:31:00Z",
  updatedAt: "2026-11-16T10:31:00Z",
};

describe("avatar system prompt", () => {
  it("keeps subtle to perspective, caresAbout in order, and ignores", () => {
    const prompt = buildAvatarSystemPrompt(avatar);
    expect(prompt).toContain("Reads every proposal as a claim on limited cash.");
    expect(prompt.indexOf("Cash runway")).toBeLessThan(prompt.indexOf("Payback period"));
    expect(prompt).toContain("Vision statements");
    expect(prompt).not.toContain("VOICE-DRY-AND-BRIEF");
    expect(prompt).not.toContain("first person");
  });

  it("adds voice for balanced and character for immersive", () => {
    const balanced = buildAvatarSystemPrompt({ ...avatar, intensity: "balanced" });
    expect(balanced).toContain("VOICE-DRY-AND-BRIEF");
    expect(balanced).not.toContain("first person");

    const immersive = buildAvatarSystemPrompt({ ...avatar, intensity: "immersive" });
    expect(immersive).toContain("VOICE-DRY-AND-BRIEF");
    expect(immersive).toContain("Answer fully in character, in the first person.");
  });
});
