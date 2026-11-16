import { z } from "zod";

const shortText = z
  .string()
  .min(1)
  .max(200)
  .describe("One short phrase, 1–200 characters.");

function uniqueStringList(min: number, max: number) {
  return z
    .array(shortText)
    .min(min)
    .max(max)
    .refine((items) => new Set(items).size === items.length, {
      message: "Items must be unique.",
    });
}

const intensitySchema = z
  .enum(["subtle", "balanced", "immersive"])
  .describe(
    "How far the avatar shapes an answer. subtle covers priorities only, balanced adds voice, immersive answers in the first person. Example: balanced.",
  );

const createdBySchema = z
  .enum(["user", "assistant"])
  .describe(
    "Who made the avatar. Send assistant when you are saving a stance because none of the existing avatars fit. Example: assistant.",
  );

/**
 * Input for create_avatar. Same fields and constraints as AvatarCreate.
 * Extra properties are rejected.
 */
export const avatarCreateSchema = z
  .strictObject({
    name: z
      .string()
      .min(1)
      .max(60)
      .describe('What people call this avatar. Unique regardless of letter case. Example: "Skeptical CFO".'),
    description: z
      .string()
      .min(1)
      .max(280)
      .describe("One or two sentences saying who this is. This is the first thing read when choosing an avatar."),
    perspective: z
      .string()
      .min(1)
      .max(1000)
      .describe("How this avatar sees the problem: what it looks at first and how it judges what it sees."),
    voice: z
      .string()
      .min(1)
      .max(1000)
      .describe("How this avatar speaks: tone, sentence length, vocabulary, and habits of form."),
    caresAbout: uniqueStringList(1, 10).describe(
      "What the avatar pays attention to, most important first. At least one item. Order matters when two concerns compete.",
    ),
    ignores: uniqueStringList(0, 10)
      .default([])
      .describe("What the avatar deliberately leaves out, even when it is relevant. May be empty."),
    useWhen: uniqueStringList(0, 10)
      .default([])
      .describe("Situations this avatar is meant for, so a later choice can find it. May be empty."),
    intensity: intensitySchema.default("balanced"),
    createdBy: createdBySchema.default("user"),
  })
  .describe("The avatar to store. Required: name, description, perspective, voice, caresAbout.");

export const getAvatarInputSchema = z.strictObject({
  avatarId: z
    .uuid()
    .describe("Identifier the service assigned when the avatar was created. Take it from list_avatars or create_avatar."),
});

export const avatarSummarySchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  useWhen: z.array(z.string()),
});

export const avatarSummaryListSchema = z.strictObject({
  items: z.array(avatarSummarySchema),
});

/** Full avatar returned by the service. Unknown keys are ignored during checks. */
export const avatarSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  perspective: z.string(),
  voice: z.string(),
  caresAbout: z.array(z.string()),
  ignores: z.array(z.string()),
  useWhen: z.array(z.string()),
  intensity: z.enum(["subtle", "balanced", "immersive"]),
  createdBy: z.enum(["user", "assistant"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Loose enough to project summaries when the service returns full avatars. */
export const avatarListResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      useWhen: z.array(z.string()).optional(),
    }),
  ),
});
