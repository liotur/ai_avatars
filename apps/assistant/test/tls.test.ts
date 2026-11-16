import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { providerFetch } from "../src/tls.js";

// A local HTTPS server with a certificate nobody trusts, standing in for a
// provider whose certificate comes from a company authority.
let url = "";
let close = () => {};

beforeAll(async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "tls-test-"));
  const key = path.join(directory, "key.pem");
  const cert = path.join(directory, "cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=localhost"], {
    stdio: "ignore",
  });
  const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true}');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `https://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  close = () => {
    server.close();
    rmSync(directory, { recursive: true, force: true });
  };
});

afterAll(() => close());

describe("providerFetch", () => {
  it("checks the certificate by default, so an untrusted one is refused", async () => {
    await expect(providerFetch(true)(url)).rejects.toThrow();
  });

  it("reaches a provider with an untrusted certificate when checking is switched off", async () => {
    const response = await providerFetch(false)(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
