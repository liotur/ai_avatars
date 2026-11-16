import type { Avatar } from "@avatars/contracts/avatar";

import type { AvatarSummary } from "./mcp.js";

export const CLASSIFIER_SYSTEM = [
  "Pick the avatar whose useWhen fits the user's message.",
  "If one fits, choose that avatar. If none fits, draft a new avatar.",
  "Return only a JSON object, with no markdown.",
  'To choose: {"decision":"choose","avatarId":"<id from the list>","reason":"<one sentence>"}',
  'To draft: {"decision":"propose","draft":{"name":"","description":"","perspective":"","voice":"","caresAbout":[""],"ignores":[],"useWhen":[],"intensity":"balanced"},"reason":"<one sentence>"}',
  "intensity is subtle, balanced, or immersive. ignores and useWhen may be empty. caresAbout needs at least one item.",
  "Do not set createdBy.",
].join("\n");

export function classifierUserPrompt(input: {
  content: string;
  summaries: readonly AvatarSummary[];
  feedback?: string;
}): string {
  const summaries = input.summaries.map((avatar) => ({
    id: avatar.id,
    name: avatar.name,
    description: avatar.description,
    useWhen: avatar.useWhen,
  }));
  const lines = [
    "Avatars:",
    JSON.stringify(summaries, null, 2),
    "",
    "User message:",
    input.content,
  ];
  if (input.feedback) {
    lines.push("", "The previous attempt was rejected:", input.feedback, "Return a corrected JSON object.");
  }
  return lines.join("\n");
}

/**
 * System prompt for the answer. Subtle uses perspective, caresAbout (in order),
 * and ignores. Balanced adds voice. Immersive also stays in character.
 */
export function buildAvatarSystemPrompt(avatar: Avatar): string {
  const lines = [
    `Answer as the avatar ${avatar.name}.`,
    avatar.description,
    `Perspective: ${avatar.perspective}`,
    "Cares about, in this order. When two concerns compete, the earlier one wins:",
    ...avatar.caresAbout.map((item, index) => `${index + 1}. ${item}`),
  ];
  if (avatar.ignores.length === 0) {
    lines.push("Ignores: nothing.");
  } else {
    lines.push("Ignores:");
    for (const item of avatar.ignores) {
      lines.push(`- ${item}`);
    }
  }
  if (avatar.intensity === "balanced" || avatar.intensity === "immersive") {
    lines.push(`Voice: ${avatar.voice}`);
  }
  if (avatar.intensity === "immersive") {
    lines.push("Answer fully in character, in the first person.");
  }
  return lines.join("\n");
}
