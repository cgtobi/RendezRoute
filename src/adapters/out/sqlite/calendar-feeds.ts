// Calendar feeds (spec 6 feature 2). Only token hashes are stored.
import type { CalendarFeed, CalendarFeedRepository } from "../../../application/ports.ts";
import type { Database } from "./database.ts";

export function createCalendarFeedRepository(database: Database): CalendarFeedRepository {
  const select = () =>
    database.db.selectFrom("calendar_feeds").select(["id", "device_id", "language", "created_at"]);
  const fromRow = (
    row: { id: string; device_id: string; language: string; created_at: string } | undefined,
  ): CalendarFeed | undefined =>
    row === undefined
      ? undefined
      : {
          id: row.id,
          deviceId: row.device_id,
          language: row.language,
          createdAt: new Date(row.created_at),
        };

  return {
    async replace({ id, deviceId, tokenHash, language, createdAt }) {
      const values = { id, token_hash: tokenHash, language, created_at: createdAt.toISOString() };
      await database.db
        .insertInto("calendar_feeds")
        .values({ ...values, device_id: deviceId })
        .onConflict((conflict) => conflict.column("device_id").doUpdateSet(values))
        .execute();
    },

    async findByTokenHash(hash) {
      return fromRow(await select().where("token_hash", "=", hash).executeTakeFirst());
    },

    async findForDevice(deviceId) {
      return fromRow(await select().where("device_id", "=", deviceId).executeTakeFirst());
    },

    async deleteForDevice(deviceId) {
      await database.db.deleteFrom("calendar_feeds").where("device_id", "=", deviceId).execute();
    },

    async deleteUnlinked() {
      const result = await database.db
        .deleteFrom("calendar_feeds")
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom("device_links")
                .select("device_id")
                .whereRef("device_links.device_id", "=", "calendar_feeds.device_id"),
            ),
          ),
        )
        .executeTakeFirst();
      return Number(result.numDeletedRows);
    },
  };
}
