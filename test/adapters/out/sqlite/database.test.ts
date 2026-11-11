import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  checkpoint,
  type Database,
  hasEncryptedData,
  openDatabase,
} from "../../../../src/adapters/out/sqlite/database.ts";
import { readMeta, writeMeta } from "../../../../src/adapters/out/sqlite/meta.ts";
import { migrations } from "../../../../src/adapters/out/sqlite/migrations/index.ts";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect, sql } from "kysely";
import { Migrator } from "kysely/migration";

const open: Database[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const database of open.splice(0)) await database.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function fileDatabase(): Promise<{ database: Database; path: string }> {
  const dir = mkdtempSync(join(tmpdir(), "rendezroute-db-"));
  dirs.push(dir);
  const path = join(dir, "rendezroute.db");
  const database = await openDatabase(path);
  open.push(database);
  return { database, path };
}

async function memoryDatabase(): Promise<Database> {
  const database = await openDatabase(":memory:");
  open.push(database);
  return database;
}

const tables = (database: Database) =>
  database.sqlite
    .prepare("select name from sqlite_master where type = 'table' order by name")
    .pluck()
    .all() as string[];

describe("openDatabase (spec 3.10 physical deletion, 4)", () => {
  it("enables foreign keys and secure_delete on every connection", async () => {
    const { database, path } = await fileDatabase();
    expect(database.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(database.sqlite.pragma("secure_delete", { simple: true })).toBe(1);

    const second = await openDatabase(path);
    open.push(second);
    expect(second.sqlite.pragma("secure_delete", { simple: true })).toBe(1);
  });

  it("uses WAL for file databases", async () => {
    const { database } = await fileDatabase();
    expect(database.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
  });

  it("applies migrations automatically and idempotently", async () => {
    const { database, path } = await fileDatabase();
    expect(tables(database)).toContain("instance_meta");

    const reopened = await openDatabase(path);
    open.push(reopened);
    expect(tables(reopened)).toContain("instance_meta");
  });
});

describe("instance meta", () => {
  it("stores and replaces values", async () => {
    const database = await memoryDatabase();
    expect(await readMeta(database, "key_fingerprint")).toBeUndefined();
    await writeMeta(database, "key_fingerprint", "abc");
    await writeMeta(database, "key_fingerprint", "def");
    expect(await readMeta(database, "key_fingerprint")).toBe("def");
  });
});

describe("hasEncryptedData (spec 3.11 key generation rule)", () => {
  it("is false for a fresh database", async () => {
    expect(hasEncryptedData(await memoryDatabase())).toBe(false);
  });

  it("is true once any *_enc column in any table holds a value", async () => {
    const database = await memoryDatabase();
    database.sqlite.exec(
      "create table test_notes (id text primary key, body_enc text, title text)",
    );
    database.sqlite.exec("insert into test_notes values ('1', null, 'plaintext title')");
    expect(hasEncryptedData(database)).toBe(false);
    database.sqlite.exec("insert into test_notes values ('2', 'v1.x.y', null)");
    expect(hasEncryptedData(database)).toBe(true);
  });
});

describe("physical deletion (spec 3.10, security test)", () => {
  it("leaves no trace of deleted content in the database or WAL file after a checkpoint", async () => {
    const { database, path } = await fileDatabase();
    const sentinel = "SENTINEL-deleted-content-91c2";
    database.sqlite.exec("create table scratch (id integer primary key, body text)");
    const insert = database.sqlite.prepare("insert into scratch (body) values (?)");
    for (let i = 0; i < 50; i++) insert.run(`${sentinel}-${i}`);
    checkpoint(database);

    database.sqlite.exec("delete from scratch");
    checkpoint(database);

    const raw = (file: string) => (existsSync(file) ? readFileSync(file).toString("latin1") : "");
    expect(raw(path)).not.toContain(sentinel);
    expect(raw(`${path}-wal`)).not.toContain(sentinel);
  });
});

describe("upgrading an existing database (migration 0003 rebuilds device_links)", () => {
  it("keeps host links created before the rebuild", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rendezroute-upgrade-"));
    dirs.push(dir);
    const path = join(dir, "rendezroute.db");

    // A database as released after step 3: migrations 0001 and 0002 only.
    const old = new Kysely<unknown>({
      dialect: new SqliteDialect({ database: new BetterSqlite3(path) }),
    });
    const upTo0002 = Object.fromEntries(
      Object.entries(migrations).filter(([name]) => name < "0003"),
    );
    const migrated = await new Migrator({
      db: old,
      provider: { getMigrations: () => Promise.resolve(upTo0002) },
    }).migrateToLatest();
    expect(migrated.error).toBeUndefined();
    const t = "2026-06-01T08:00:00.000Z";
    await sql`insert into plans (id, poster_name, poster_language, activity_type, title, starts_at, timezone, area_label,
      drop_policy, recap_window, retention_days, delete_at, host_token_hash, created_at, updated_at)
      values ('plan-1', 'Anna', 'en', 'run', 'Run', ${t}, 'UTC', 'Park', 'no_drop', '1w', 14, ${t}, 'hash', ${t}, ${t})`.execute(
      old,
    );
    await sql`insert into devices values ('device-1', 'token-hash', ${t}, ${t})`.execute(old);
    await sql`insert into device_links (device_id, role, plan_id, created_at) values ('device-1', 'host', 'plan-1', ${t})`.execute(
      old,
    );
    await old.destroy();

    const upgraded = await openDatabase(path);
    open.push(upgraded);
    const links = upgraded.sqlite
      .prepare("select device_id, role, plan_id, response_id from device_links")
      .all();
    expect(links).toEqual([
      { device_id: "device-1", role: "host", plan_id: "plan-1", response_id: null },
    ]);
    expect(upgraded.sqlite.pragma("foreign_key_check")).toEqual([]);
  });
});

describe("upgrading an existing database (migrations 0025 and 0026 rebuild plans and jobs)", () => {
  it("keeps every plan and every row referring to one, then allows followers only with an owner", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rendezroute-upgrade-"));
    dirs.push(dir);
    const path = join(dir, "rendezroute.db");

    // A database as released with 0.8: migrations up to 0024.
    const old = new Kysely<unknown>({
      dialect: new SqliteDialect({ database: new BetterSqlite3(path) }),
    });
    const upTo0024 = Object.fromEntries(
      Object.entries(migrations).filter(([name]) => name < "0025"),
    );
    expect(
      (
        await new Migrator({
          db: old,
          provider: { getMigrations: () => Promise.resolve(upTo0024) },
        }).migrateToLatest()
      ).error,
    ).toBeUndefined();
    const t = "2026-06-01T08:00:00.000Z";
    await sql`insert into identities (id, provider, subject_hmac, subject_enc, created_at, last_active_at)
      values ('identity-1', 'oidc', 'hmac', 'enc', ${t}, ${t})`.execute(old);
    await sql`insert into plans (id, poster_name, poster_language, activity_type, title, starts_at, timezone, area_label,
      drop_policy, recap_window, retention_days, delete_at, host_token_hash, created_at, updated_at, visibility, owner_identity_id)
      values ('plan-1', 'Anna', 'en', 'run', 'Run', ${t}, 'UTC', 'Park', 'no_drop', '1w', 14, ${t}, 'hash', ${t}, ${t}, 'public', 'identity-1')`.execute(
      old,
    );
    await sql`insert into devices values ('device-1', 'token-hash', ${t}, ${t}, null)`.execute(old);
    // Logged in to the account that owns the plan.
    await sql`insert into devices values ('device-2', 'token-hash-2', ${t}, ${t}, 'identity-1')`.execute(
      old,
    );
    await sql`insert into device_links (device_id, role, plan_id, created_at) values ('device-1', 'host', 'plan-1', ${t})`.execute(
      old,
    );
    await sql`insert into responses (id, plan_id, kind, display_name_enc, manage_token_hash, language, created_at, updated_at)
      values ('response-1', 'plan-1', 'joined', 'enc', 'manage-hash', 'en', ${t}, ${t})`.execute(
      old,
    );
    await sql`insert into job_queue (id, type, payload_enc, plan_id, run_at)
      values ('job-1', 'notification', 'enc', 'plan-1', ${t})`.execute(old);
    await old.destroy();

    const upgraded = await openDatabase(path);
    open.push(upgraded);
    const one = (query: string) => upgraded.sqlite.prepare(query).all();
    expect(one("select id, visibility, owner_identity_id, federated_at from plans")).toEqual([
      { id: "plan-1", visibility: "public", owner_identity_id: "identity-1", federated_at: null },
    ]);
    expect(one("select id from responses")).toEqual([{ id: "response-1" }]);
    // The job table, rebuilt by 0026 for the delivery jobs, keeps its jobs.
    expect(one("select id, type, plan_id from job_queue")).toEqual([
      { id: "job-1", type: "notification", plan_id: "plan-1" },
    ]);
    expect(one("select plan_id from device_links")).toEqual([{ plan_id: "plan-1" }]);
    // The view of what each device may reach survived the rebuild: by link and by account.
    expect(one("select device_id, plan_id from device_access where source = 'link'")).toEqual([
      { device_id: "device-1", plan_id: "plan-1" },
    ]);
    expect(
      one("select device_id, role, plan_id from device_access where source = 'account'"),
    ).toEqual([{ device_id: "device-2", role: "host", plan_id: "plan-1" }]);
    expect(
      one(
        "select name from sqlite_master where type = 'index' and tbl_name = 'plans' and name not like 'sqlite_%' order by name",
      ),
    ).toEqual([
      { name: "plans_delete_at" },
      { name: "plans_owner_identity_id" },
      { name: "plans_public_area" },
      { name: "plans_starts_at" },
    ]);
    expect(upgraded.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(upgraded.sqlite.pragma("foreign_key_check")).toEqual([]);

    // Followers needs an account owner (spec 4); deleting a plan still cascades.
    upgraded.sqlite.prepare("update plans set visibility = 'followers' where id = 'plan-1'").run();
    expect(() =>
      upgraded.sqlite
        .prepare("update plans set owner_identity_id = null where id = 'plan-1'")
        .run(),
    ).toThrow(/CHECK constraint failed/);
    upgraded.sqlite.prepare("delete from plans where id = 'plan-1'").run();
    expect(one("select id from responses")).toEqual([]);
  });
});
