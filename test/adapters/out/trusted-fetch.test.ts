// Fetch for the OIDC issuer, trusted configuration (decision D23): private addresses allowed, but
// HTTPS only (plain http in development), no redirects, a timeout and a size limit.
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createTrustedFetch } from "../../../src/adapters/out/http/trusted-fetch.ts";

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (server === undefined) resolve();
    else server.close(() => resolve());
  });
  server = undefined;
});

/** A local server answering every request with `handle`; returns its base URL. */
async function serve(handle: Parameters<typeof createServer>[1]) {
  server = createServer(handle);
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  return `http://127.0.0.1:${address.port}`;
}

const trusted = (options: { maxBytes?: number; timeoutMs?: number } = {}) =>
  createTrustedFetch({ userAgent: "RendezRoute (test)", allowHttp: true, ...options });

describe("trusted fetch (decision D23)", () => {
  it("reaches a private address, sending its user agent", async () => {
    let agent: string | undefined;
    const base = await serve((req, res) => {
      agent = req.headers["user-agent"];
      res.end('{"ok":true}');
    });
    const response = await trusted()(`${base}/x`, {});
    expect(await response.json()).toEqual({ ok: true });
    expect(agent).toBe("RendezRoute (test)");
  });

  it("allows plain http only in development", async () => {
    const fetch = createTrustedFetch({ userAgent: "test", allowHttp: false });
    await expect(fetch("http://127.0.0.1:1/x", {})).rejects.toThrow(/Only https/);
    await expect(fetch("ftp://example.org/x", {})).rejects.toThrow(/Only https/);
  });

  it("does not follow redirects", async () => {
    const base = await serve((_req, res) => {
      res.writeHead(302, { location: "http://169.254.169.254/" }).end();
    });
    const response = await trusted()(`${base}/x`, {});
    expect(response.status).toBe(302);
  });

  it("answers bodiless statuses without a body", async () => {
    const base = await serve((_req, res) => {
      res.writeHead(204).end();
    });
    const response = await trusted()(`${base}/x`, {});
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it("refuses answers over the size limit, by length and while reading", async () => {
    const big = await serve((_req, res) => {
      res.writeHead(200, { "content-length": "2000" }).end("x".repeat(2000));
    });
    await expect(trusted({ maxBytes: 1000 })(`${big}/x`, {})).rejects.toThrow(/too large/);
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    const chunked = await serve((_req, res) => {
      res.write("x".repeat(600));
      res.end("x".repeat(600));
    });
    await expect(trusted({ maxBytes: 1000 })(`${chunked}/x`, {})).rejects.toThrow(/too large/);
  });

  it("gives up after the timeout", async () => {
    const base = await serve(() => {
      // Never answers.
    });
    await expect(trusted({ timeoutMs: 50 })(`${base}/x`, {})).rejects.toThrow(/timeout|abort/i);
  });
});
