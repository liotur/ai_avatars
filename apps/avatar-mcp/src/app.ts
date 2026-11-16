import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { DEFAULT_HOST, HEALTH_PATH, MCP_PATH } from "./constants.js";
import { createAvatarMcpServer } from "./server.js";
import type { AvatarClient } from "./services/avatar-api.js";

/**
 * HTTP app: GET /health for probes, and stateless Streamable HTTP on /mcp.
 * Tool calls are JSON responses; this server does not keep MCP sessions.
 */
export function createHttpApp(client: AvatarClient, options: { host?: string } = {}) {
  const host = options.host ?? DEFAULT_HOST;
  const app = createMcpExpressApp({ host });

  app.get(HEALTH_PATH, (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.post(MCP_PATH, async (req, res) => {
    const server = createAvatarMcpServer(client);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP request failed:", error instanceof Error ? error.message : "unknown error");
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get(MCP_PATH, (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  });
  app.delete(MCP_PATH, (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  });

  return app;
}
