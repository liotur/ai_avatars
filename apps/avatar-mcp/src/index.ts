import type { Server } from "node:http";

import { createHttpApp } from "./app.js";
import { loadConfig } from "./config.js";
import { HEALTH_PATH, MCP_PATH, SERVER_NAME } from "./constants.js";
import { AvatarClient } from "./services/avatar-api.js";

/**
 * Avatar MCP server. Thin tool adapter over the avatar REST API.
 * It does not open the database.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const app = createHttpApp(new AvatarClient(config.avatarApiUrl), { host: config.host });

  const httpServer: Server = await new Promise((resolve, reject) => {
    const server = app.listen(config.port, config.host, () => {
      resolve(server);
    });
    server.on("error", reject);
  });

  console.log(
    `${SERVER_NAME} listening on ${config.host}:${config.port} (GET ${HEALTH_PATH}, POST ${MCP_PATH}) → ${config.avatarApiUrl}`,
  );

  const shutdown = (signal: string): void => {
    console.log(`Received ${signal}, shutting down`);
    httpServer.close(() => {
      process.exit(0);
    });
  };
  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
