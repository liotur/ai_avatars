import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { AvatarClient } from "./services/avatar-api.js";
import { registerAvatarTools } from "./tools/avatars.js";

/** Stateless MCP server. A new instance is connected per HTTP request. */
export function createAvatarMcpServer(client: AvatarClient = new AvatarClient()): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });
  registerAvatarTools(server, client);
  return server;
}
