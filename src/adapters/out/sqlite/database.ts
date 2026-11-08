// SQLite connection, pragmas and migrations (spec 2, 3.10 "Physical deletion", 4).
import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { Migrator } from "kysely/migration";
import { createBackupStore } from "./backups.ts";
import { migrations } from "./migrations/index.ts";
import type { DatabaseSchema } from "./schema.ts";

export interface Database {
  /** Raw handle for pragmas, checkpoints and low-level checks; queries go through `db`. */
  sqlite: BetterSqlite3.Database;
  db: Kysely<DatabaseSchema>;
  close(): Promise<void>;
}

export interface OpenOptions {
  /** Where to back up an existing database before migrations change it (spec 11). */
  backups?: { dir: string; now: () => Date } | undefined;
}

export async function openDatabase(path: string, options: OpenOptions = {}): Promise<Database> {
  const sqlite = new BetterSqlite3(path);
  // Set on every connection: deleted content is overwritten, not just unlinked.
  sqlite.pragma("secure_delete = ON");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  if (path !== ":memory:") {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("synchronous = NORMAL");
  }

  const db = new Kysely<DatabaseSchema>({ dialect: new SqliteDialect({ database: sqlite }) });

  const migrator = new Migrator({
    db,
    provider: { getMigrations: () => Promise.resolve(migrations) },
  });
  if (options.backups !== undefined) {
    const known = await migrator.getMigrations();
    const upgrading =
      known.some((migration) => migration.executedAt !== undefined) &&
      known.some((migration) => migration.executedAt === undefined);
    if (upgrading) {
      await createBackupStore(options.backups.dir).write(sqlite, options.backups.now());
    }
  }

  const { error } = await migrator.migrateToLatest();
  if (error !== undefined) {
    await db.destroy();
    throw new Error("Database migration failed", { cause: error });
  }

  return { sqlite, db, close: () => db.destroy() };
}

/** Folds the WAL into the database and truncates it, so deleted content leaves the WAL too. */
export function checkpoint(database: Database): void {
  database.sqlite.pragma("wal_checkpoint(TRUNCATE)");
}

/** True if any `*_enc` column in any table holds a value (spec 3.11: keys are generated only when none does). */
export function hasEncryptedData(database: Database): boolean {
  const tables = database.sqlite
    .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
    .pluck()
    .all() as string[];

  for (const table of tables) {
    const columns = database.sqlite.pragma(`table_info("${table}")`) as { name: string }[];
    for (const { name } of columns.filter((column) => column.name.endsWith("_enc"))) {
      const found = database.sqlite
        .prepare(`select 1 from "${table}" where "${name}" is not null limit 1`)
        .get();
      if (found !== undefined) return true;
    }
  }
  return false;
}
