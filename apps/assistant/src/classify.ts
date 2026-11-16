import { zAvatarCreate } from "@avatars/contracts/avatar/zod";
import { z } from "zod";

/** AvatarCreate without createdBy. The assistant sets createdBy when it saves. */
export const avatarDraftSchema = zAvatarCreate.omit({ createdBy: true });

export const classificationSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("choose"),
    avatarId: z.uuid(),
    reason: z.string().min(1),
  }),
  z.object({
    decision: z.literal("propose"),
    draft: avatarDraftSchema,
    reason: z.string().min(1),
  }),
]);

export type Classification = z.infer<typeof classificationSchema>;
export type AvatarDraft = z.infer<typeof avatarDraftSchema>;
