import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUTOX_API_VERSION,
  DEFAULT_AUTOX_APPLICATION,
  DEFAULT_AUTOX_BASE_URL,
  DEFAULT_LLM_MODEL,
  ConfigError,
  loadConfig,
} from "../src/config.js";
import { parseEnv } from "../src/env.js";

const secret = "super-secret-autox-key";

function valid(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    AUTOX_KEY: secret,
    AUTOX_USERNAME: "arman",
    ...overrides,
  };
}

describe("loadConfig", () => {
  it("applies AutoX defaults and keeps the key out of errors", () => {
    const config = loadConfig(valid());
    expect(config).toMatchObject({
      port: 3002,
      corsOrigin: "http://localhost:5173",
      avatarMcpUrl: "http://localhost:3001/mcp",
      llmProvider: "autox",
      autoxKey: secret,
      autoxUsername: "arman",
      autoxBaseUrl: DEFAULT_AUTOX_BASE_URL,
      autoxApiVersion: DEFAULT_AUTOX_API_VERSION,
      autoxApplication: DEFAULT_AUTOX_APPLICATION,
      llmModel: DEFAULT_LLM_MODEL,
    });

    expect(() => loadConfig({ AUTOX_KEY: secret })).toThrow(ConfigError);
    try {
      loadConfig({ AUTOX_KEY: secret });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).toContain("AUTOX_USERNAME");
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it("falls through empty AUTOX_KEY and AUTOX_USERNAME", () => {
    const config = loadConfig({
      AUTOX_KEY: "  ",
      LLM_API_KEY: secret,
      AUTOX_USERNAME: "",
      USERNAME: "from-shell",
      LLM_PROVIDER: "autox",
    });
    expect(config.autoxKey).toBe(secret);
    expect(config.autoxUsername).toBe("from-shell");
  });

  it("refuses a missing key, a bad base URL, and any provider other than autox", () => {
    expect(() => loadConfig({ AUTOX_USERNAME: "arman" })).toThrow(/AUTOX_KEY is required/);
    expect(() => loadConfig(valid({ AUTOX_BASE_URL: "not a url" }))).toThrow(/AUTOX_BASE_URL/);
    expect(() => loadConfig(valid({ LLM_MODEL: "" }))).not.toThrow();
    expect(loadConfig(valid({ LLM_MODEL: "" })).llmModel).toBe(DEFAULT_LLM_MODEL);
    expect(() => loadConfig(valid({ LLM_PROVIDER: "openai" }))).toThrow(/autox/);
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
