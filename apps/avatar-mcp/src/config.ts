import { z } from "zod";

import {
  DEFAULT_AVATAR_API_URL,
  DEFAULT_HOST,
  DEFAULT_PORT,
} from "./constants.js";

export interface AppConfig {
  avatarApiUrl: string;
  port: number;
  host: string;
}

const portSchema = z.coerce.number().int().min(1).max(65535);

/**
 * Read configuration once at startup. Invalid values throw a short message
 * so the process stops before it listens.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    avatarApiUrl: resolveAvatarApiUrl(env),
    port: resolvePort(env),
    host: resolveHost(env),
  };
}

/** Base URL of the avatar REST API, without a trailing slash. */
export function resolveAvatarApiUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.AVATAR_API_URL?.trim();
  const value = raw ? raw : DEFAULT_AVATAR_API_URL;
  const parsed = z.url().safeParse(value);
  if (!parsed.success) {
    throw new Error(`AVATAR_API_URL must be an absolute URL. Received: ${value}`);
  }
  return parsed.data.replace(/\/+$/, "");
}

function resolvePort(env: NodeJS.ProcessEnv): number {
  const raw = env.PORT?.trim();
  const value = raw ? raw : String(DEFAULT_PORT);
  const parsed = portSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return parsed.data;
}

function resolveHost(env: NodeJS.ProcessEnv): string {
  const raw = env.HOST?.trim();
  return raw ? raw : DEFAULT_HOST;
}
