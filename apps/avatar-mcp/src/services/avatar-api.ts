import { AVATAR_API_TIMEOUT_MS } from "../constants.js";
import { resolveAvatarApiUrl } from "../config.js";
import type { AvatarCreate } from "../types.js";

/** Failure from the avatar REST API. `message` is safe to show to an agent. */
export class AvatarApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AvatarApiError";
    this.status = status;
  }
}

/**
 * HTTP client for the avatar service. This process never opens the database;
 * every read and write goes through the REST API.
 */
export class AvatarClient {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl ?? resolveAvatarApiUrl()).replace(/\/+$/, "");
  }

  listAvatars(): Promise<unknown> {
    return this.request("/avatars", "GET");
  }

  getAvatar(avatarId: string): Promise<unknown> {
    return this.request(`/avatars/${encodeURIComponent(avatarId)}`, "GET");
  }

  createAvatar(body: AvatarCreate): Promise<unknown> {
    return this.request("/avatars", "POST", body);
  }

  private async request(path: string, method: "GET" | "POST", body?: unknown): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      accept: "application/json, application/problem+json",
    };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(AVATAR_API_TIMEOUT_MS),
      });
    } catch (error) {
      throw new AvatarApiError(networkMessage(error, url), 0);
    }

    const text = await response.text();
    if (!response.ok) {
      throw new AvatarApiError(messageFromProblem(text, response.status), response.status);
    }
    if (text.trim() === "") {
      throw new AvatarApiError("Avatar API returned an empty response.", response.status);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new AvatarApiError("Avatar API returned a response that was not JSON.", response.status);
    }
  }
}

function networkMessage(error: unknown, url: string): string {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return `The avatar API timed out calling ${url}. Try again.`;
  }
  const reason = error instanceof Error ? error.message : "unknown network error";
  return `Could not reach the avatar API at ${url}. ${reason}`;
}

/**
 * Turn an RFC 9457 problem body into the text an agent should see.
 * The detail is the message. Field errors, when present, follow it so a
 * rejected draft can be corrected. Stack traces are never included.
 */
export function messageFromProblem(text: string, status: number): string {
  const fallback = `Avatar API returned HTTP ${status}.`;
  const trimmed = text.trim();
  if (!trimmed) {
    return fallback;
  }

  let body: unknown;
  try {
    body = JSON.parse(trimmed) as unknown;
  } catch {
    return fallback;
  }
  if (!isRecord(body)) {
    return fallback;
  }

  const detail = typeof body.detail === "string" ? body.detail.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const head = detail || title || fallback;
  const extras: string[] = [];

  if (Array.isArray(body.errors)) {
    for (const entry of body.errors) {
      if (!isRecord(entry)) {
        continue;
      }
      const field = typeof entry.field === "string" ? entry.field : "";
      const message = typeof entry.message === "string" ? entry.message : "";
      if (field && message) {
        extras.push(`${field}: ${message}`);
      }
    }
  }

  return extras.length > 0 ? `${head}\n${extras.join("\n")}` : head;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
