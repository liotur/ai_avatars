import type { Problem } from "@avatars/contracts/assistant";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { $ZodIssue } from "zod/v4/core";

export class HttpProblem extends Error {
  readonly problem: Problem;

  constructor(problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = "HttpProblem";
    this.problem = problem;
  }
}

export function problem(c: Context, body: Problem): Response {
  return c.body(JSON.stringify(body), body.status as ContentfulStatusCode, {
    "Content-Type": "application/problem+json",
  });
}

export function validationFailed(c: Context, errors: Array<{ field: string; message: string }>): Response {
  const count = errors.length;
  return problem(c, {
    type: "https://assistant.local/problems/validation-failed",
    title: "Request validation failed",
    status: 400,
    detail: count === 1 ? "1 field is invalid." : `${count} fields are invalid.`,
    errors,
  });
}

export function validationFailedFromZod(c: Context, error: { issues: readonly $ZodIssue[] }): Response {
  return validationFailed(c, fieldErrorsFromZod(error));
}

export function sessionNotFound(c: Context, sessionId: string): Response {
  return problem(c, {
    type: "https://assistant.local/problems/session-not-found",
    title: "Session not found",
    status: 404,
    detail: `No session with id ${sessionId}. Open a new one.`,
  });
}

export function avatarNotFoundProblem(avatarId: string): HttpProblem {
  return new HttpProblem({
    type: "https://assistant.local/problems/avatar-not-found",
    title: "Avatar not found",
    status: 404,
    detail: `No avatar with id ${avatarId}.`,
  });
}

export function llmFailed(detail: string): HttpProblem {
  return new HttpProblem({
    type: "https://assistant.local/problems/llm-failed",
    title: "Language model call failed",
    status: 502,
    detail,
  });
}

export function mcpFailed(detail: string): HttpProblem {
  return new HttpProblem({
    type: "https://assistant.local/problems/avatar-mcp-failed",
    title: "Avatar MCP server call failed",
    status: 502,
    detail,
  });
}

export function fieldErrorsFromZod(error: { issues: readonly $ZodIssue[] }): Array<{ field: string; message: string }> {
  const errors: Array<{ field: string; message: string }> = [];
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys" && "keys" in issue && Array.isArray(issue.keys)) {
      for (const key of issue.keys) {
        errors.push({
          field: jsonPointer([...issue.path, String(key)]),
          message: "is not allowed",
        });
      }
      continue;
    }
    errors.push({
      field: jsonPointer(issue.path),
      message: messageFor(issue),
    });
  }
  if (errors.length === 0) {
    errors.push({ field: "/", message: "Request validation failed." });
  }
  return errors;
}

function messageFor(issue: $ZodIssue): string {
  if (issue.code === "too_small" && "origin" in issue && issue.origin === "string") {
    return "must NOT have fewer than 1 characters";
  }
  return issue.message;
}

function jsonPointer(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return "/";
  return `/${path.map((segment) => String(segment).replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
}
