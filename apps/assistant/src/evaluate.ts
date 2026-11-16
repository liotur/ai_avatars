import { z } from "zod";

/** What a draft answer is checked for before the person sees it. */
export const CHECKS = ["answers", "sound", "stance", "voice"] as const;
export type CheckName = (typeof CHECKS)[number];

/** The shape of the model's reply to the check. */
export const evaluationSchema = z.object({
  checks: z.object({
    answers: z.boolean(),
    sound: z.boolean(),
    stance: z.boolean(),
    voice: z.boolean(),
  }),
  advice: z.string().optional().default(""),
});

export type Evaluation = z.infer<typeof evaluationSchema>;

/** The checks a draft failed, in the order they are listed. Empty when it passes. */
export function failedChecks(evaluation: Evaluation): CheckName[] {
  return CHECKS.filter((name) => !evaluation.checks[name]);
}

const WHAT_TO_FIX: Record<CheckName, string> = {
  answers: "Answer what the person actually asked.",
  sound: "Remove or correct what is false or contradicts itself.",
  stance: "Write from the avatar's perspective, put first what it cares about most, and leave out what it ignores.",
  voice: "Use the wording that fits the avatar's intensity.",
};

/** What to tell the writer to change: the checker's own advice, or a plain line for each failed check. */
export function adviceFor(evaluation: Evaluation): string {
  const advice = evaluation.advice.trim();
  if (advice) return advice.length > 600 ? `${advice.slice(0, 600)}…` : advice;
  return failedChecks(evaluation)
    .map((name) => WHAT_TO_FIX[name])
    .join(" ");
}
