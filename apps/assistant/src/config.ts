import { z } from "zod";

import { redact } from "./redact.js";

export const DEFAULT_AUTOX_BASE_URL = "https://chat.autox.corp.amdocs.azr/api/v1/proxy/openai";
export const DEFAULT_AUTOX_API_VERSION = "2025-03-01-preview";
export const DEFAULT_AUTOX_APPLICATION = "autox-merged-ui";
export const DEFAULT_LLM_MODEL = "gpt-4.1-mini";

export type Config = {
  port: number;
  corsOrigin: string;
  avatarMcpUrl: string;
  llmProvider: "autox";
  autoxKey: string;
  autoxUsername: string;
  autoxBaseUrl: string;
  autoxApiVersion: string;
  autoxApplication: string;
  llmModel: string;
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const configSchema = z.object({
  port: z.custom<number>(
    (value) => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535,
    { error: "PORT must be an integer from 1 to 65535" },
  ),
  corsOrigin: z.url({ error: "CORS_ORIGIN must be a valid URL" }),
  avatarMcpUrl: z.url({ error: "AVATAR_MCP_URL must be a valid URL" }),
  llmProvider: z.literal("autox", { error: "LLM_PROVIDER must be autox" }),
  autoxKey: z.string().min(1, { error: "AUTOX_KEY is required (LLM_API_KEY is the fallback)" }),
  autoxUsername: z.string().min(1, { error: "AUTOX_USERNAME is required (USERNAME is the fallback)" }),
  autoxBaseUrl: z.url({ error: "AUTOX_BASE_URL must be a valid URL" }),
  autoxApiVersion: z.string().min(1, { error: "AUTOX_API_VERSION is required" }),
  autoxApplication: z.string().min(1, { error: "AUTOX_APPLICATION is required" }),
  llmModel: z.string().min(1, { error: "LLM_MODEL is required" }),
});

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readPort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 3002;
  if (!/^\d+$/.test(value.trim())) return Number.NaN;
  return Number(value.trim());
}

/**
 * Read assistant settings from the environment. Empty `AUTOX_KEY` and
 * `AUTOX_USERNAME` fall through to `LLM_API_KEY` and `USERNAME`. Other empty
 * AutoX values fall through to the defaults. The key is never included in
 * the error text.
 */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const autoxKey = nonEmpty(env.AUTOX_KEY) ?? nonEmpty(env.LLM_API_KEY) ?? "";
  const autoxUsername = nonEmpty(env.AUTOX_USERNAME) ?? nonEmpty(env.USERNAME) ?? "";
  const draft = {
    port: readPort(env.PORT),
    corsOrigin: nonEmpty(env.CORS_ORIGIN) ?? "http://localhost:5173",
    avatarMcpUrl: nonEmpty(env.AVATAR_MCP_URL) ?? "http://localhost:3001/mcp",
    llmProvider: nonEmpty(env.LLM_PROVIDER) ?? "autox",
    autoxKey,
    autoxUsername,
    autoxBaseUrl: nonEmpty(env.AUTOX_BASE_URL) ?? DEFAULT_AUTOX_BASE_URL,
    autoxApiVersion: nonEmpty(env.AUTOX_API_VERSION) ?? DEFAULT_AUTOX_API_VERSION,
    autoxApplication: nonEmpty(env.AUTOX_APPLICATION) ?? DEFAULT_AUTOX_APPLICATION,
    llmModel: nonEmpty(env.LLM_MODEL) ?? DEFAULT_LLM_MODEL,
  };

  const parsed = configSchema.safeParse(draft);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => {
        const path = issue.path.join(".");
        const text = redact(issue.message, autoxKey);
        return path ? `${path}: ${text}` : text;
      })
      .join("\n");
    throw new ConfigError(message);
  }
  return parsed.data;
}
