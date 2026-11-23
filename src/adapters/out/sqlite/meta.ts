import type { ReportAlertState } from "../../../application/ports.ts";
import type { Database } from "./database.ts";

/**
 * key_fingerprint: the encryption key's check (3.11); telegram_offset: the next bot update (D34);
 * report_alert_sent_at: when the latest report alert email goes out, ISO 8601 (0.19.0).
 */
export type MetaKey = "key_fingerprint" | "telegram_offset" | "report_alert_sent_at";

export async function readMeta(database: Database, key: MetaKey): Promise<string | undefined> {
  const row = await database.db
    .selectFrom("instance_meta")
    .select("value")
    .where("key", "=", key)
    .executeTakeFirst();
  return row?.value;
}

export async function writeMeta(database: Database, key: MetaKey, value: string): Promise<void> {
  await database.db
    .insertInto("instance_meta")
    .values({ key, value })
    .onConflict((conflict) => conflict.column("key").doUpdateSet({ value }))
    .execute();
}

/** The report alert throttle's stored time (see `ReportAlertState`). */
export function createReportAlertState(database: Database): ReportAlertState {
  return {
    async read() {
      const value = await readMeta(database, "report_alert_sent_at");
      const at = value === undefined ? undefined : new Date(value);
      return at === undefined || Number.isNaN(at.getTime()) ? undefined : at;
    },
    write: (at) => writeMeta(database, "report_alert_sent_at", at.toISOString()),
  };
}
