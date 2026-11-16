import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Problem } from "./types.js";

export type FieldError = {
  field: string;
  message: string;
};

export function problem(c: Context, body: Problem): Response {
  return c.body(JSON.stringify(body), body.status as ContentfulStatusCode, {
    "Content-Type": "application/problem+json",
  });
}

export function validationFailed(c: Context, errors: FieldError[]): Response {
  const count = errors.length;
  const detail = count === 1 ? "1 field is invalid." : `${count} fields are invalid.`;
  return problem(c, {
    type: "https://avatar.local/problems/validation-failed",
    title: "Request validation failed",
    status: 400,
    detail,
    errors,
  });
}

export function fieldErrorsFromIssues(issues: ReadonlyArray<unknown>): FieldError[] {
  const errors: FieldError[] = [];
  for (const issue of issues) {
    const parsed = asIssue(issue);
    if (!parsed) continue;
    if (parsed.code === "unrecognized_keys" && parsed.keys) {
      for (const key of parsed.keys) {
        errors.push({
          field: jsonPointer([...parsed.path, key]),
          message: "is not allowed",
        });
      }
      continue;
    }
    errors.push({
      field: jsonPointer(parsed.path),
      message: messageFor(parsed),
    });
  }
  if (errors.length === 0) {
    errors.push({ field: "/", message: "Request validation failed." });
  }
  return errors;
}

export function notFoundProblem(c: Context, id: string): Response {
  return problem(c, {
    type: "https://avatar.local/problems/avatar-not-found",
    title: "Avatar not found",
    status: 404,
    detail: `No avatar with id ${id}.`,
  });
}

export function nameTakenProblem(c: Context, name: string): Response {
  return problem(c, {
    type: "https://avatar.local/problems/name-taken",
    title: "Avatar name already in use",
    status: 409,
    detail: `An avatar named "${name}" already exists.`,
  });
}

type IssueLike = {
  code: string;
  message: string;
  path: ReadonlyArray<PropertyKey>;
  keys?: ReadonlyArray<PropertyKey>;
  origin?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
};

function asIssue(value: unknown): IssueLike | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const issue = value as Record<string, unknown>;
  if (typeof issue.code !== "string" || typeof issue.message !== "string" || !Array.isArray(issue.path)) {
    return undefined;
  }
  return {
    code: issue.code,
    message: issue.message,
    path: issue.path as PropertyKey[],
    ...(Array.isArray(issue.keys) ? { keys: issue.keys as PropertyKey[] } : {}),
    ...(typeof issue.origin === "string" ? { origin: issue.origin } : {}),
    ...(typeof issue.minimum === "number" || typeof issue.minimum === "bigint"
      ? { minimum: issue.minimum }
      : {}),
    ...(typeof issue.maximum === "number" || typeof issue.maximum === "bigint"
      ? { maximum: issue.maximum }
      : {}),
  };
}

function messageFor(issue: IssueLike): string {
  if (issue.code === "too_small" && issue.origin === "array" && issue.minimum !== undefined) {
    const minimum = Number(issue.minimum);
    return `must contain at least ${minimum} ${minimum === 1 ? "item" : "items"}`;
  }
  if (issue.code === "too_big" && issue.origin === "array" && issue.maximum !== undefined) {
    const maximum = Number(issue.maximum);
    return `must contain at most ${maximum} items`;
  }
  return issue.message;
}

function jsonPointer(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return "/";
  return `/${path.map((segment) => escapePointer(String(segment))).join("/")}`;
}

function escapePointer(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}
