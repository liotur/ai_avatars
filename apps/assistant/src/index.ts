import { serve } from "@hono/node-server";

import { createAutoxModel } from "./autox.js";
import { createApp } from "./app.js";
import { createChatModel } from "./chat.js";
import { ConfigError, loadConfig, type LlmConfig } from "./config.js";
import { loadEnvFiles } from "./env.js";
import { createAvatarMcp } from "./mcp.js";
import type { AssistantModel } from "./model.js";

loadEnvFiles();

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error("Invalid configuration:");
    console.error(error.message);
  } else {
    console.error("The assistant failed to start.");
  }
  process.exit(1);
}

function createAssistantModel(llm: LlmConfig): AssistantModel {
  return llm.kind === "autox" ? createAutoxModel(llm) : createChatModel(llm);
}

// Without a usable model the assistant still starts. It opens sessions and
// reports what is missing, so the UI can explain it.
const { llm } = config;
const app = createApp({
  mcp: createAvatarMcp(config.avatarMcpUrl),
  corsOrigin: config.corsOrigin,
  checkAnswers: config.checkAnswers,
  ...(llm.ready
    ? {
        model: createAssistantModel(llm.llm),
        status: { ready: true, provider: llm.llm.provider, model: llm.llm.model },
        ...(llm.llm.key ? { apiKey: llm.llm.key } : {}),
      }
    : { status: { ready: false, detail: llm.detail } }),
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`assistant listening on ${info.port}`);
  if (llm.ready) {
    console.log(`language model: ${llm.llm.label}, ${llm.llm.model}`);
    console.log(`answer check: ${config.checkAnswers ? "on" : "off (ANSWER_CHECK)"}`);
  } else {
    console.error(`language model: NOT CONFIGURED. ${llm.detail}`);
  }
});
