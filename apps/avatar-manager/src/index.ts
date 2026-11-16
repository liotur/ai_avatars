import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const { app } = createApp({
  databasePath: config.databasePath,
  corsOrigin: config.corsOrigin,
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`avatar-manager listening on http://localhost:${info.port}/v1`);
  console.log(`database ${config.databasePath}`);
});
