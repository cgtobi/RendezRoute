// Pre-migration backups (spec 11, decision I12): written with SQLite's online backup API before
// migrations change an existing database; at most the two most recent are kept, and the daily
// housekeeping deletes them after 7 days, so backups never outlive retention by more than a week.
import { chmodSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import type { BackupStore } from "../../../application/ports.ts";

const PREFIX = "pre-migration-";
const NAME = /^pre-migration-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.db$/;
const KEEP = 2;

export interface BackupDirectory extends BackupStore {
  dir: string;
  /** Writes a backup of the open database and keeps only the most recent ones. */
  write(sqlite: BetterSqlite3.Database, now: Date): Promise<void>;
}

/** Backup file names carry their creation time, so expiry does not depend on file times. */
const fileName = (time: Date) =>
  `${PREFIX}${time.toISOString().replaceAll(":", "-").replace(".", "-")}.db`;

const createdAt = (name: string): Date | undefined => {
  const match = NAME.exec(name);
  return match === null
    ? undefined
    : new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`);
};

export function createBackupStore(dir: string): BackupDirectory {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const backups = () =>
    readdirSync(dir)
      .map((name) => ({ name, time: createdAt(name) }))
      .filter((entry): entry is { name: string; time: Date } => entry.time !== undefined)
      .sort((a, b) => a.time.getTime() - b.time.getTime());

  return {
    dir,
    async write(sqlite, now) {
      const path = join(dir, fileName(now));
      await sqlite.backup(path);
      chmodSync(path, 0o600);
      for (const old of backups().slice(0, -KEEP)) rmSync(join(dir, old.name), { force: true });
    },
    deleteOlderThan(cutoff) {
      const expired = backups().filter((entry) => entry.time < cutoff);
      for (const entry of expired) rmSync(join(dir, entry.name), { force: true });
      return Promise.resolve(expired.length);
    },
  };
}
