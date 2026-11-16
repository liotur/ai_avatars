import { serve } from "@hono/node-server";

import { createAutoxModel } from "./autox.js";
import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { loadEnvFiles } from "./env.js";
import { createAvatarMcp } from "./mcp.js";

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

const app = createApp({
  mcp: createAvatarMcp(config.avatarMcpUrl),
  model: createAutoxModel(config),
  corsOrigin: config.corsOrigin,
  apiKey: config.autoxKey,
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`assistant listening on ${info.port}`);
});
