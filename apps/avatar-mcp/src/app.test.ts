import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { createHttpApp } from "./app.js";
import { AvatarClient } from "./services/avatar-api.js";

describe("GET /health", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) {
      return;
    }
    const closing = server;
    server = undefined;
    await new Promise<void>((resolve, reject) => {
      closing.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  it("returns status ok outside the MCP route", async () => {
    const app = createHttpApp(new AvatarClient("http://localhost:3000/v1"), { host: "127.0.0.1" });
    server = await new Promise<Server>((resolve, reject) => {
      const listening = app.listen(0, "127.0.0.1", () => {
        resolve(listening);
      });
      listening.on("error", reject);
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected a TCP port");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
