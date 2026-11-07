import { afterEach, describe, expect, it } from "vite-plus/test";
import { type RunningServer, startServer } from "../src/main.ts";

let running: RunningServer | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

describe("startServer", () => {
  it("serves /healthz on a real socket", async () => {
    const result = await startServer(
      { BASE_URL: "https://runs.example.org", CONTACT_EMAIL: "owner@example.org" },
      { port: 0 },
    );
    if (!result.ok) throw new Error(result.errors.join("; "));
    running = result.server;

    const response = await fetch(new URL("/healthz", running.url));
    expect(response.status).toBe(200);
  });

  it("refuses to start with invalid configuration and returns every error", async () => {
    const result = await startServer(
      { BASE_URL: "http://runs.example.org", MAX_RETENTION_DAYS: "45" },
      { port: 0 },
    );
    expect(result).toEqual({ ok: false, errors: [expect.any(String), expect.any(String)] });
  });

  it("returns configuration warnings", async () => {
    const result = await startServer({ BASE_URL: "https://runs.example.org" }, { port: 0 });
    if (!result.ok) throw new Error(result.errors.join("; "));
    running = result.server;
    expect(result.warnings).toEqual([expect.stringContaining("CONTACT_EMAIL")]);
  });
});
