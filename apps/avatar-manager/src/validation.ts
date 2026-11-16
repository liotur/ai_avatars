import { zAvatarCreate, zAvatarId, zAvatarUpdate } from "@avatars/contracts/avatar/zod";
import type { RefinementCtx } from "zod";
import { z } from "zod";

const listFields = ["caresAbout", "ignores", "useWhen"] as const;

type ListCarrier = {
  caresAbout?: readonly string[] | undefined;
  ignores?: readonly string[] | undefined;
  useWhen?: readonly string[] | undefined;
};

function rejectDuplicateItems(data: ListCarrier, ctx: RefinementCtx): void {
  for (const field of listFields) {
    const list = data[field];
    if (!list) continue;
    const seen = new Set<string>();
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index];
      if (item === undefined) continue;
      if (seen.has(item)) {
        ctx.addIssue({
          code: "custom",
          path: [field, index],
          message: "items must be unique",
        });
      } else {
        seen.add(item);
      }
    }
  }
}

const textFields = ["name", "description", "perspective", "voice"] as const;

// Surrounding whitespace is not part of a value: "  " is empty, and " Generalist"
// must collide with "Generalist" so a name always identifies one avatar.
function trimStrings(input: unknown): unknown {
  if (!isPlainObject(input)) return input;
  const output: Record<string, unknown> = { ...input };
  for (const field of textFields) {
    const value = output[field];
    if (typeof value === "string") output[field] = value.trim();
  }
  for (const field of listFields) {
    const value = output[field];
    if (Array.isArray(value)) {
      output[field] = value.map((item) => (typeof item === "string" ? item.trim() : item));
    }
  }
  return output;
}

export const zAvatarCreateRequest = z.preprocess(
  trimStrings,
  zAvatarCreate.strict().superRefine((data, ctx) => {
    rejectDuplicateItems(data, ctx);
  }),
);

// minProperties counts keys in the JSON object. Unknown keys fail
// additionalProperties on their own, so they must not also look like an empty patch.
export const zAvatarUpdateRequest = z
  .unknown()
  .transform(trimStrings)
  .superRefine((input, ctx) => {
    if (isPlainObject(input) && Object.keys(input).length < 1) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: "must contain at least 1 field",
      });
    }

    const parsed = zAvatarUpdate.strict().safeParse(input);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ ...issue });
      }
      return;
    }
    rejectDuplicateItems(parsed.data, ctx);
  })
  .transform((input): z.output<typeof zAvatarUpdate> => {
    const parsed = zAvatarUpdate.strict().safeParse(input);
    return parsed.success ? parsed.data : {};
  });

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const zAvatarIdParam = z.object({
  avatarId: zAvatarId,
});

export type AvatarCreateBody = z.output<typeof zAvatarCreateRequest>;
export type AvatarUpdateBody = z.output<typeof zAvatarUpdateRequest>;
