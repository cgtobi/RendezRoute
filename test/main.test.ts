import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { type RunningServer, startServer } from "../src/main.ts";

const running: RunningServer[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const server of running.splice(0)) await server.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function env(extra: Record<string, string> = {}): Record<string, string> {
  const dataDir = mkdtempSync(join(tmpdir(), "rendezroute-main-"));
  dirs.push(dataDir);
  return {
    BASE_URL: "https://runs.example.org",
    CONTACT_EMAIL: "owner@example.org",
    DATA_DIR: dataDir,
    ...extra,
  };
}

async function start(vars: Record<string, string>) {
  const result = await startServer(vars, { port: 0 });
  if (result.ok) running.push(result.server);
  return result;
}

describe("startServer", () => {
  it("serves /healthz on a real socket", async () => {
    const result = await start(env());
    if (!result.ok) throw new Error(result.errors.join("; "));
    const response = await fetch(new URL("/healthz", result.server.url));
    expect(response.status).toBe(200);
  });

  it("refuses to start with invalid configuration and returns every error", async () => {
    const result = await start({ BASE_URL: "http://runs.example.org", MAX_RETENTION_DAYS: "45" });
    expect(result).toEqual({ ok: false, errors: [expect.any(String), expect.any(String)] });
  });

  it("warns when the key falls back to DATA_DIR and when CONTACT_EMAIL is missing", async () => {
    const vars = env();
    delete vars.CONTACT_EMAIL;
    const result = await start(vars);
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.warnings).toEqual([
      expect.stringContaining("CONTACT_EMAIL"),
      expect.stringContaining("Backups of DATA_DIR"),
    ]);
  });
});

describe("encryption key handling at startup (spec 3.11)", () => {
  it("generates a key on first start and reuses it afterwards", async () => {
    const vars = env();
    const keyFile = join(vars.DATA_DIR ?? "", "secrets", "field.key");
    vars.ENCRYPTION_KEY_FILE = keyFile;

    const first = await start(vars);
    if (!first.ok) throw new Error(first.errors.join("; "));
    expect(first.warnings).toEqual([]);
    await running.pop()?.close();

    const second = await start(vars);
    expect(second.ok).toBe(true);
  });

  it("refuses to start when the key does not match the database", async () => {
    const vars = env();
    const keyFile = join(vars.DATA_DIR ?? "", "secrets", "field.key");
    vars.ENCRYPTION_KEY_FILE = keyFile;
    const first = await start(vars);
    if (!first.ok) throw new Error(first.errors.join("; "));
    await running.pop()?.close();

    writeFileSync(keyFile, `1:${Buffer.alloc(32, 7).toString("base64")}\n`);
    const second = await start(vars);
    expect(second).toEqual({ ok: false, errors: [expect.stringContaining("does not match")] });
  });
});
