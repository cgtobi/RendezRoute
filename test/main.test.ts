import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import BetterSqlite3 from "better-sqlite3";
import { runApplyRetentionMax, type RunningServer, startServer } from "../src/main.ts";

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

/** A key directory outside DATA_DIR, as spec 3.11 recommends. */
function keyDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rendezroute-keys-"));
  dirs.push(dir);
  return dir;
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
    const keyFile = join(keyDir(), "field.key");
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
    const keyFile = join(keyDir(), "field.key");
    vars.ENCRYPTION_KEY_FILE = keyFile;
    const first = await start(vars);
    if (!first.ok) throw new Error(first.errors.join("; "));
    await running.pop()?.close();

    writeFileSync(keyFile, `1:${Buffer.alloc(32, 7).toString("base64")}\n`);
    const second = await start(vars);
    expect(second).toEqual({ ok: false, errors: [expect.stringContaining("does not match")] });
  });
});

/** Inserts a plan directly, as if stored before downtime (no encrypted fields needed). */
function insertPlan(dataDir: string, id: string, retentionDays: number, deleteAt: string) {
  const db = new BetterSqlite3(join(dataDir, "rendezroute.db"));
  const t = "2026-01-01T00:00:00.000Z";
  db.prepare(
    `insert into plans (id, poster_name, poster_language, activity_type, title, starts_at, timezone, area_label,
      drop_policy, recap_window, retention_days, delete_at, host_token_hash, created_at, updated_at)
     values (?, 'Anna', 'en', 'run', 'Run', ?, 'UTC', 'Park', 'no_drop', '1d', ?, ?, ?, ?, ?)`,
  ).run(id, "2026-01-01T08:00:00.000Z", retentionDays, deleteAt, `hash-${id}`, t, t);
  db.close();
}

describe("retention at startup (spec 3.10: sweep at startup)", () => {
  it("deletes plans past their deletion date before serving", async () => {
    const vars = env();
    const first = await start(vars);
    if (!first.ok) throw new Error(first.errors.join("; "));
    await running.pop()?.close();
    insertPlan(vars.DATA_DIR ?? "", "expired", 1, "2026-01-02T08:00:00.000Z");
    insertPlan(vars.DATA_DIR ?? "", "future", 1, "2999-01-01T00:00:00.000Z");

    const second = await start(vars);
    if (!second.ok) throw new Error(second.errors.join("; "));
    const db = new BetterSqlite3(join(vars.DATA_DIR ?? "", "rendezroute.db"), { readonly: true });
    expect(db.prepare("select id from plans order by id").pluck().all()).toEqual(["future"]);
    db.close();
  });
});

describe("apply-retention-max (spec 3.10)", () => {
  it("applies a lowered maximum to existing plans and reports what changed", async () => {
    const vars = env();
    const first = await start(vars);
    if (!first.ok) throw new Error(first.errors.join("; "));
    await running.pop()?.close();
    insertPlan(vars.DATA_DIR ?? "", "long", 30, "2999-01-31T08:00:00.000Z");
    insertPlan(vars.DATA_DIR ?? "", "short", 2, "2999-01-03T08:00:00.000Z");

    const result = await runApplyRetentionMax({ ...vars, MAX_RETENTION_DAYS: "7" });
    // The key falls back to DATA_DIR in this test, so the CLI must report that warning too.
    expect(result).toEqual({
      ok: true,
      shortened: 0,
      deleted: 1,
      warnings: [expect.stringContaining("DATA_DIR")],
    });
  });

  it("refuses to run with invalid configuration", async () => {
    expect(await runApplyRetentionMax({ BASE_URL: "nope" })).toMatchObject({ ok: false });
  });
});
