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
