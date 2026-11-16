import { describe, expect, it } from "vitest";

import { adviceFor, evaluationSchema, failedChecks } from "../src/evaluate.js";

const pass = { answers: true, sound: true, stance: true, voice: true };

describe("answer check result", () => {
  it("reads a reply with or without advice", () => {
    expect(evaluationSchema.parse({ checks: pass })).toEqual({ checks: pass, advice: "" });
    expect(evaluationSchema.safeParse({ checks: { ...pass, voice: "yes" } }).success).toBe(false);
    expect(evaluationSchema.safeParse({ checks: { answers: true } }).success).toBe(false);
  });

  it("lists the failed checks in a fixed order", () => {
    expect(failedChecks({ checks: pass, advice: "" })).toEqual([]);
    expect(failedChecks({ checks: { ...pass, voice: false, answers: false }, advice: "" })).toEqual(["answers", "voice"]);
  });

  it("uses the checker's advice, or says what each failed check needs", () => {
    expect(adviceFor({ checks: { ...pass, stance: false }, advice: "  Lead with the cash runway. " })).toBe("Lead with the cash runway.");
    expect(adviceFor({ checks: { ...pass, answers: false, sound: false }, advice: "" })).toBe(
      "Answer what the person actually asked. Remove or correct what is false or contradicts itself.",
    );
    expect(adviceFor({ checks: { ...pass, voice: false }, advice: "x".repeat(700) })).toHaveLength(601);
  });
});
