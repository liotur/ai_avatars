import { z } from "zod";

export const DEFAULT_AUTOX_BASE_URL = "https://chat.autox.corp.amdocs.azr/api/v1/proxy/openai";
export const DEFAULT_AUTOX_API_VERSION = "2025-03-01-preview";
export const DEFAULT_AUTOX_APPLICATION = "autox-merged-ui";
export const DEFAULT_AUTOX_MODEL = "gpt-4.1-mini";

/**
 * AutoX is the provider this project is set up for. These are the alternatives
 * for running it without access to AutoX: providers that speak the OpenAI
 * chat-completions protocol (`POST {baseUrl}/chat/completions`). `keyPrefix`
 * lets a pasted key choose the provider, so `LLM_API_KEY` can be the only setting.
 */
type ChatProvider = {
  label: string;
  keyPrefix?: string;
  baseUrl?: string;
  /** How the key is sent. Left out for a provider that needs no key. */
  auth?: { header: string; prefix: string };
  defaultModel?: string;
};

const BEARER = { header: "Authorization", prefix: "Bearer " };

export const CHAT_PROVIDERS = {
  gemini: {
    label: "Google Gemini",
    keyPrefix: "AIza",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    auth: BEARER,
    defaultModel: "gemini-flash-latest",
  },
  openai: {
    label: "OpenAI",
    keyPrefix: "sk-",
    baseUrl: "https://api.openai.com/v1",
    auth: BEARER,
    defaultModel: "gpt-4.1-mini",
  },
  openrouter: {
    label: "OpenRouter",
    keyPrefix: "sk-or-",
    baseUrl: "https://openrouter.ai/api/v1",
    auth: BEARER,
  },
  ollama: {
    label: "Ollama",
    baseUrl: "http://localhost:11434/v1",
  },
  custom: {
    label: "OpenAI-compatible endpoint",
    auth: BEARER,
  },
} satisfies Record<string, ChatProvider>;

export type ChatProviderName = keyof typeof CHAT_PROVIDERS;
export const PROVIDER_NAMES = ["autox", ...Object.keys(CHAT_PROVIDERS)] as const;

/** Amdocs AutoX: the OpenAI Responses protocol with its own headers. */
export type AutoxLlm = {
  kind: "autox";
  provider: "autox";
  label: string;
  model: string;
  key: string;
  username: string;
  baseUrl: string;
  apiVersion: string;
  application: string;
};

export type ChatLlm = {
  kind: "chat";
  provider: ChatProviderName;
  label: string;
  model: string;
  /** Empty for a provider that needs no key. */
  key: string;
  baseUrl: string;
  headers: Record<string, string>;
};

export type LlmConfig = AutoxLlm | ChatLlm;

/**
 * The model settings, or why they cannot be used. The assistant starts either
 * way: without a model it still opens sessions and reports `detail`, so the
 * UI can say what to change instead of showing a gateway error.
 */
export type LlmState = { ready: true; llm: LlmConfig } | { ready: false; detail: string };

export type Config = {
  port: number;
  corsOrigin: string;
  avatarMcpUrl: string;
  llm: LlmState;
  /** Whether a draft is checked, and rewritten when it fails, before the person sees the answer. */
  checkAnswers: boolean;
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const serviceSchema = z.object({
  port: z.custom<number>(
    (value) => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535,
    { error: "PORT must be an integer from 1 to 65535" },
  ),
  corsOrigin: z.url({ error: "CORS_ORIGIN must be a valid URL" }),
  avatarMcpUrl: z.url({ error: "AVATAR_MCP_URL must be a valid URL" }),
});

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** True for the values that switch an on-by-default setting off. */
function isOff(value: string | undefined): boolean {
  return ["off", "false", "0", "no"].includes(value?.trim().toLowerCase() ?? "");
}

function readPort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 3002;
  if (!/^\d+$/.test(value.trim())) return Number.NaN;
  return Number(value.trim());
}

/**
 * Read assistant settings from the environment. A bad port or URL of its own
 * stops startup. A missing or unusable model setting does not: it is reported
 * in `llm.detail`. No message ever contains the key.
 */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = serviceSchema.safeParse({
    port: readPort(env.PORT),
    corsOrigin: nonEmpty(env.CORS_ORIGIN) ?? "http://localhost:5173",
    avatarMcpUrl: nonEmpty(env.AVATAR_MCP_URL) ?? "http://localhost:3001/mcp",
  });
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((issue) => issue.message).join("\n"));
  }
  return { ...parsed.data, llm: resolveLlm(env), checkAnswers: !isOff(env.ANSWER_CHECK) };
}

/**
 * Key prefixes of services that are not built in but begin like an OpenAI key.
 * A key is only ever sent to the provider it belongs to, so these are not guessed.
 */
const FOREIGN_KEY_PREFIXES = ["sk-ant-"];

/** The chat provider whose key prefix matches. The longest prefix wins, so `sk-or-` is not read as OpenAI. */
export function detectProvider(key: string): ChatProviderName | undefined {
  if (FOREIGN_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) return undefined;
  let best: ChatProviderName | undefined;
  let bestLength = 0;
  for (const [name, provider] of Object.entries(CHAT_PROVIDERS) as Array<[ChatProviderName, ChatProvider]>) {
    const prefix = provider.keyPrefix;
    if (prefix && key.startsWith(prefix) && prefix.length > bestLength) {
      best = name;
      bestLength = prefix.length;
    }
  }
  return best;
}

export function resolveLlm(env: NodeJS.ProcessEnv): LlmState {
  const known = PROVIDER_NAMES.join(", ");
  const explicit = nonEmpty(env.LLM_PROVIDER)?.toLowerCase();
  const autoxKey = nonEmpty(env.AUTOX_KEY);
  const key = nonEmpty(env.LLM_API_KEY);

  let name = explicit;
  if (!name) {
    if (autoxKey) {
      name = "autox";
    } else if (key) {
      name = detectProvider(key);
      if (!name) {
        return notReady(
          `LLM_API_KEY is set, but its provider could not be recognised. Set LLM_PROVIDER to one of: ${known}. ` +
            "For a service that is not listed, use custom with LLM_BASE_URL and LLM_MODEL.",
        );
      }
    } else {
      return notReady(
        "No language model is set up. Put AUTOX_USERNAME and AUTOX_KEY in the .env file at the project root, " +
          "then start the app again.",
      );
    }
  }

  if (name === "autox") return resolveAutox(env);
  if (!(name in CHAT_PROVIDERS)) {
    // The value is shown only when it looks like a provider name, never when it could be a key.
    const shown = /^[a-z][a-z0-9_-]{0,19}$/.test(name) ? ` is "${name}"` : " is not a provider name";
    return notReady(`LLM_PROVIDER${shown}. It must be one of: ${known}.`);
  }
  return resolveChat(name as ChatProviderName, env);
}

function resolveAutox(env: NodeJS.ProcessEnv): LlmState {
  const key = nonEmpty(env.AUTOX_KEY) ?? nonEmpty(env.LLM_API_KEY);
  const username = nonEmpty(env.AUTOX_USERNAME) ?? nonEmpty(env.LLM_USERNAME) ?? nonEmpty(env.USERNAME);
  const baseUrl = baseAddress(nonEmpty(env.AUTOX_BASE_URL) ?? DEFAULT_AUTOX_BASE_URL, "/responses");
  const missing: string[] = [];
  if (!key) missing.push("AUTOX_KEY is required (LLM_API_KEY is the fallback).");
  if (!username) missing.push("AUTOX_USERNAME is required (LLM_USERNAME and USERNAME are the fallbacks).");
  if (!baseUrl) missing.push("AUTOX_BASE_URL must be an address that starts with http:// or https://.");
  if (!key || !username || !baseUrl) return notReady(`The autox provider is not set up. ${missing.join(" ")}`);
  return {
    ready: true,
    llm: {
      kind: "autox",
      provider: "autox",
      label: "Amdocs AutoX",
      model: nonEmpty(env.LLM_MODEL) ?? DEFAULT_AUTOX_MODEL,
      key,
      username,
      baseUrl,
      apiVersion: nonEmpty(env.AUTOX_API_VERSION) ?? DEFAULT_AUTOX_API_VERSION,
      application: nonEmpty(env.AUTOX_APPLICATION) ?? DEFAULT_AUTOX_APPLICATION,
    },
  };
}

function resolveChat(name: ChatProviderName, env: NodeJS.ProcessEnv): LlmState {
  const provider: ChatProvider = CHAT_PROVIDERS[name];
  const key = nonEmpty(env.LLM_API_KEY) ?? "";
  if (provider.auth && !key) {
    return notReady(`The ${name} provider needs LLM_API_KEY.`);
  }
  const configured = nonEmpty(env.LLM_BASE_URL) ?? provider.baseUrl;
  if (!configured) {
    return notReady(`The ${name} provider needs LLM_BASE_URL (the address its API is served from).`);
  }
  const baseUrl = baseAddress(configured, "/chat/completions");
  if (!baseUrl) {
    return notReady("LLM_BASE_URL must be an address that starts with http:// or https://.");
  }
  const model = nonEmpty(env.LLM_MODEL) ?? provider.defaultModel;
  if (!model) {
    return notReady(`The ${name} provider has no default model. Set LLM_MODEL.`);
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (provider.auth) headers[provider.auth.header] = provider.auth.prefix + key;

  return {
    ready: true,
    llm: { kind: "chat", provider: name, label: provider.label, model, key, baseUrl, headers },
  };
}

function notReady(detail: string): LlmState {
  return { ready: false, detail };
}

/**
 * A provider's base address without trailing slashes, or undefined when it is
 * not an http or https address. `host:port/v1` without a scheme parses as a URL
 * but cannot be called, so the scheme is checked. Someone who pastes the full
 * endpoint gets the same result as with the base, since `endpoint` is removed.
 */
function baseAddress(value: string, endpoint: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  const trimmed = value.replace(/\/+$/, "");
  return trimmed.endsWith(endpoint) ? trimmed.slice(0, -endpoint.length).replace(/\/+$/, "") : trimmed;
}
