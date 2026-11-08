import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { Migrator } from "kysely/migration";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createBackupStore } from "../../../../src/adapters/out/sqlite/backups.ts";
import { openDatabase } from "../../../../src/adapters/out/sqlite/database.ts";
import { migrations } from "../../../../src/adapters/out/sqlite/migrations/index.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "rendezroute-backups-"));
  dirs.push(dir);
  return { path: join(dir, "rendezroute.db"), backupDir: join(dir, "backups") };
}

/** A database as an older release left it: only the first `count` migrations applied. */
async function olderDatabase(path: string, count: number) {
  const sqlite = new BetterSqlite3(path);
  const db = new Kysely({ dialect: new SqliteDialect({ database: sqlite }) });
  const subset = Object.fromEntries(Object.entries(migrations).slice(0, count));
  const { error } = await new Migrator({
    db,
    provider: { getMigrations: () => Promise.resolve(subset) },
  }).migrateToLatest();
  if (error !== undefined) throw error;
  sqlite.prepare("insert into instance_meta (key, value) values ('marker', 'old')").run();
  await db.destroy();
}

const at = (iso: string) => () => new Date(iso);
const files = (dir: string) => readdirSync(dir).sort();

describe("pre-migration backups (spec 11, decision I12)", () => {
  it("are written with SQLite's backup API before migrations change an existing database", async () => {
    const { path, backupDir } = setup();
    await olderDatabase(path, 4);
    const database = await openDatabase(path, {
      backups: { dir: backupDir, now: at("2026-11-08T09:30:00Z") },
    });
    await database.close();

    expect(files(backupDir)).toEqual(["pre-migration-2026-11-08T09-30-00-000Z.db"]);
    const backupPath = join(backupDir, "pre-migration-2026-11-08T09-30-00-000Z.db");
    expect(statSync(backupPath).mode & 0o777).toBe(0o600);
    const backup = new BetterSqlite3(backupPath, { readonly: true });
    const tables = backup
      .prepare("select name from sqlite_master where type = 'table'")
      .pluck()
      .all();
    expect(
      backup.prepare("select value from instance_meta where key = 'marker'").pluck().get(),
    ).toBe("old");
    // The backup holds the old schema, before the fifth migration.
    expect(tables).not.toContain("plan_previews");
    backup.close();
  });

  it("are skipped for a new database and for one that is up to date", async () => {
    const { path, backupDir } = setup();
    const options = { backups: { dir: backupDir, now: at("2026-11-08T09:30:00Z") } };
    await (await openDatabase(path, options)).close();
    await (await openDatabase(path, options)).close();
    expect(existsSync(backupDir)).toBe(false);
  });

  it("keep only the two most recent", async () => {
    const { path, backupDir } = setup();
    await olderDatabase(path, 1);
    const store = createBackupStore(backupDir);
    for (const name of [
      "pre-migration-2026-11-01T00-00-00-000Z.db",
      "pre-migration-2026-11-05T00-00-00-000Z.db",
    ]) {
      writeFileSync(join(store.dir, name), "", { flag: "w" });
    }
    await (
      await openDatabase(path, { backups: { dir: backupDir, now: at("2026-11-08T09:30:00Z") } })
    ).close();
    expect(files(backupDir)).toEqual([
      "pre-migration-2026-11-05T00-00-00-000Z.db",
      "pre-migration-2026-11-08T09-30-00-000Z.db",
    ]);
  });

  it("are deleted after 7 days by the store, which ignores other files", async () => {
    const { backupDir } = setup();
    const store = createBackupStore(backupDir);
    for (const name of [
      "pre-migration-2026-10-31T09-29-59-000Z.db",
      "pre-migration-2026-11-02T00-00-00-000Z.db",
      "notes.txt",
    ]) {
      writeFileSync(join(store.dir, name), "");
    }
    expect(await store.deleteOlderThan(new Date("2026-11-01T09:30:00Z"))).toBe(1);
    expect(files(backupDir)).toEqual(["notes.txt", "pre-migration-2026-11-02T00-00-00-000Z.db"]);
  });
});
