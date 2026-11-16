import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUTOX_API_VERSION,
  DEFAULT_AUTOX_APPLICATION,
  DEFAULT_AUTOX_BASE_URL,
  DEFAULT_AUTOX_MODEL,
  ConfigError,
  detectProvider,
  loadConfig,
  resolveLlm,
  type LlmConfig,
} from "../src/config.js";
import { parseEnv } from "../src/env.js";

const secret = "super-secret-autox-key";
const GEMINI_KEY = `AIza${"x".repeat(35)}`;

function ready(env: NodeJS.ProcessEnv): LlmConfig {
  const state = resolveLlm(env);
  if (!state.ready) throw new Error(`Expected a usable model, got: ${state.detail}`);
  return state.llm;
}

function notReady(env: NodeJS.ProcessEnv): string {
  const state = resolveLlm(env);
  if (state.ready) throw new Error("Expected the model settings to be refused.");
  return state.detail;
}

describe("loadConfig", () => {
  it("applies the service defaults and starts without a model", () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      port: 3002,
      corsOrigin: "http://localhost:5173",
      avatarMcpUrl: "http://localhost:3001/mcp",
    });
    expect(config.llm.ready).toBe(false);
  });

  it("checks answers unless ANSWER_CHECK switches it off", () => {
    expect(loadConfig({}).checkAnswers).toBe(true);
    expect(loadConfig({ ANSWER_CHECK: "on" }).checkAnswers).toBe(true);
    for (const value of ["off", "OFF", " false ", "0", "no"]) {
      expect(loadConfig({ ANSWER_CHECK: value }).checkAnswers).toBe(false);
    }
  });

  it("refuses a bad port or URL of its own", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(ConfigError);
    expect(() => loadConfig({ AVATAR_MCP_URL: "not a url" })).toThrow(/AVATAR_MCP_URL/);
    expect(() => loadConfig({ CORS_ORIGIN: "nope" })).toThrow(/CORS_ORIGIN/);
  });
});

describe("resolveLlm", () => {
  it("says what to set when nothing is configured", () => {
    expect(notReady({})).toMatch(/AUTOX_USERNAME and AUTOX_KEY/);
    expect(notReady({})).toMatch(/docker compose up -d/);
  });

  it("needs only a Gemini key", () => {
    const llm = ready({ LLM_API_KEY: GEMINI_KEY });
    expect(llm).toMatchObject({
      kind: "chat",
      provider: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-flash-latest",
    });
    if (llm.kind !== "chat") return;
    expect(llm.headers.Authorization).toBe(`Bearer ${GEMINI_KEY}`);
  });

  it("recognises the provider from the key, and the longest prefix wins", () => {
    expect(detectProvider("sk-or-v1-abc")).toBe("openrouter");
    expect(detectProvider("sk-proj-abc")).toBe("openai");
    expect(detectProvider("something-else")).toBeUndefined();
    expect(notReady({ LLM_API_KEY: "something-else" })).toMatch(/Set LLM_PROVIDER to one of: autox, gemini/);
  });

  it("needs an address and a model for a custom endpoint", () => {
    expect(notReady({ LLM_PROVIDER: "custom", LLM_API_KEY: "k" })).toMatch(/LLM_BASE_URL/);
    expect(notReady({ LLM_PROVIDER: "custom", LLM_API_KEY: "k", LLM_BASE_URL: "https://gateway.test/v1" })).toMatch(/Set LLM_MODEL/);
    const llm = ready({ LLM_PROVIDER: "custom", LLM_API_KEY: "k", LLM_BASE_URL: "https://gateway.test/v1/", LLM_MODEL: "m" });
    expect(llm).toMatchObject({ kind: "chat", provider: "custom", baseUrl: "https://gateway.test/v1", model: "m" });
    if (llm.kind !== "chat") return;
    expect(llm.headers.Authorization).toBe("Bearer k");
  });

  it("lets an explicit provider and model override detection and defaults", () => {
    const llm = ready({
      LLM_API_KEY: GEMINI_KEY,
      LLM_PROVIDER: "custom",
      LLM_BASE_URL: "https://gateway.test/v1",
      LLM_MODEL: "my-model",
    });
    expect(llm).toMatchObject({ provider: "custom", model: "my-model", baseUrl: "https://gateway.test/v1" });
  });

  it("runs Ollama without a key but not without a model", () => {
    expect(notReady({ LLM_PROVIDER: "ollama" })).toMatch(/LLM_MODEL/);
    const llm = ready({ LLM_PROVIDER: "ollama", LLM_MODEL: "llama3" });
    expect(llm).toMatchObject({ provider: "ollama", baseUrl: "http://localhost:11434/v1", key: "" });
    if (llm.kind !== "chat") return;
    expect(llm.headers.Authorization).toBeUndefined();
  });

  it("explains each mistake without showing the key", () => {
    expect(notReady({ LLM_API_KEY: "x", LLM_PROVIDER: "nope" })).toMatch(/must be one of/);
    expect(notReady({ LLM_PROVIDER: "openai" })).toMatch(/needs LLM_API_KEY/);
    expect(notReady({ LLM_API_KEY: "sk-or-v1-abc" })).toMatch(/Set LLM_MODEL/);
    expect(notReady({ LLM_API_KEY: GEMINI_KEY, LLM_BASE_URL: "not a url" })).toMatch(/LLM_BASE_URL must be an address/);
    for (const env of [
      { LLM_API_KEY: secret },
      { LLM_API_KEY: secret, LLM_PROVIDER: "nope" },
      { AUTOX_KEY: secret },
      { AUTOX_KEY: secret, AUTOX_USERNAME: "arman", AUTOX_BASE_URL: "not a url" },
    ]) {
      expect(notReady(env)).not.toContain(secret);
    }
  });

  it("does not repeat a key that was pasted on the LLM_PROVIDER line", () => {
    const pasted = "AIzaSyD-MixedCase-Key-0123456789abcdefg";
    const detail = notReady({ LLM_PROVIDER: pasted });
    expect(detail).toMatch(/LLM_PROVIDER is not a provider name/);
    expect(detail).not.toContain(pasted);
    expect(detail.toLowerCase()).not.toContain(pasted.toLowerCase());
    // A short typo is still shown, because that helps.
    expect(notReady({ LLM_PROVIDER: "opnai" })).toMatch(/LLM_PROVIDER is "opnai"/);
  });

  it("does not send another service's key to OpenAI because it starts with sk-", () => {
    expect(detectProvider("sk-ant-api03-abc")).toBeUndefined();
    const detail = notReady({ LLM_API_KEY: "sk-ant-api03-abc" });
    expect(detail).toMatch(/could not be recognised/);
    expect(detail).toMatch(/custom with LLM_BASE_URL and LLM_MODEL/);
    // Naming the provider is still possible.
    expect(
      ready({ LLM_API_KEY: "sk-ant-api03-abc", LLM_PROVIDER: "custom", LLM_BASE_URL: "https://gateway.test/v1", LLM_MODEL: "m" }),
    ).toMatchObject({ provider: "custom" });
  });

  it("needs an http or https base address, and accepts the full endpoint in its place", () => {
    for (const bad of ["localhost:11434/v1", "host.docker.internal:11434/v1", "ftp://files.test/v1"]) {
      expect(notReady({ LLM_PROVIDER: "ollama", LLM_MODEL: "llama3", LLM_BASE_URL: bad })).toMatch(
        /LLM_BASE_URL must be an address that starts with http/,
      );
    }
    expect(
      ready({ LLM_PROVIDER: "custom", LLM_API_KEY: "k", LLM_MODEL: "m", LLM_BASE_URL: "https://host/api/v1/chat/completions/" }),
    ).toMatchObject({ baseUrl: "https://host/api/v1" });
    expect(
      ready({ AUTOX_KEY: secret, AUTOX_USERNAME: "arman", AUTOX_BASE_URL: "https://autox.test/proxy/openai/responses" }),
    ).toMatchObject({ baseUrl: "https://autox.test/proxy/openai" });
    expect(notReady({ AUTOX_KEY: secret, AUTOX_USERNAME: "arman", AUTOX_BASE_URL: "autox.test:443/x" })).toMatch(/AUTOX_BASE_URL/);
  });

  it("chooses AutoX when AUTOX_KEY is set, with its defaults", () => {
    expect(ready({ AUTOX_KEY: secret, AUTOX_USERNAME: "arman" })).toEqual({
      kind: "autox",
      provider: "autox",
      label: "Amdocs AutoX",
      model: DEFAULT_AUTOX_MODEL,
      key: secret,
      username: "arman",
      baseUrl: DEFAULT_AUTOX_BASE_URL,
      apiVersion: DEFAULT_AUTOX_API_VERSION,
      application: DEFAULT_AUTOX_APPLICATION,
    });
    expect(notReady({ AUTOX_KEY: secret })).toMatch(/AUTOX_USERNAME is required/);
    expect(notReady({ AUTOX_USERNAME: "arman", LLM_PROVIDER: "autox" })).toMatch(/AUTOX_KEY is required/);
    expect(notReady({ AUTOX_KEY: secret, AUTOX_USERNAME: "arman", AUTOX_BASE_URL: "not a url" })).toMatch(/AUTOX_BASE_URL/);
  });

  it("falls through empty AUTOX_KEY and AUTOX_USERNAME to their aliases", () => {
    const llm = ready({
      AUTOX_KEY: "  ",
      LLM_API_KEY: secret,
      AUTOX_USERNAME: "",
      USERNAME: "from-shell",
      LLM_PROVIDER: "autox",
    });
    expect(llm).toMatchObject({ kind: "autox", key: secret, username: "from-shell" });
  });
});

describe("parseEnv", () => {
  it("reads assignments and ignores comments", () => {
    expect(parseEnv('# note\nAUTOX_KEY="abc"\nexport USERNAME=ada\n\n')).toEqual({
      AUTOX_KEY: "abc",
      USERNAME: "ada",
    });
  });
});
