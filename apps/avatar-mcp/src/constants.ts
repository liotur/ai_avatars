/** MCP server identity. The name follows `{service}-mcp-server`. */
export const SERVER_NAME = "avatar-mcp-server";
export const SERVER_VERSION = "0.1.0";

export const DEFAULT_AVATAR_API_URL = "http://localhost:3000/v1";
export const DEFAULT_PORT = 3001;
export const DEFAULT_HOST = "0.0.0.0";

/** Streamable HTTP endpoint. Health stays on a separate route. */
export const MCP_PATH = "/mcp";
export const HEALTH_PATH = "/health";

export const AVATAR_API_TIMEOUT_MS = 30_000;
