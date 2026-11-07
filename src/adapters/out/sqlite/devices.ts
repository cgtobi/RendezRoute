// Devices and their links (spec 3.2). Only token hashes are stored.
import type { DeviceRepository } from "../../../application/ports.ts";
import type { Database } from "./database.ts";

export function createDeviceRepository(database: Database): DeviceRepository {
  return {
    async findByTokenHash(hash) {
      const row = await database.db
        .selectFrom("devices")
        .select(["id", "last_seen_at"])
        .where("token_hash", "=", hash)
        .executeTakeFirst();
      return row === undefined ? undefined : { id: row.id, lastSeenAt: new Date(row.last_seen_at) };
    },

    async create({ id, tokenHash, now }) {
      const at = now.toISOString();
      await database.db
        .insertInto("devices")
        .values({ id, token_hash: tokenHash, created_at: at, last_seen_at: at })
        .execute();
    },

    async touch(id, now) {
      await database.db
        .updateTable("devices")
        .set({ last_seen_at: now.toISOString() })
        .where("id", "=", id)
        .execute();
    },

    async linkHost(deviceId, planId, now) {
      await database.db
        .insertInto("device_links")
        .values({
          device_id: deviceId,
          role: "host",
          plan_id: planId,
          created_at: now.toISOString(),
        })
        .onConflict((conflict) => conflict.doNothing())
        .execute();
    },

    async isHost(deviceId, planId) {
      const row = await database.db
        .selectFrom("device_links")
        .select("device_id")
        .where("device_id", "=", deviceId)
        .where("plan_id", "=", planId)
        .where("role", "=", "host")
        .executeTakeFirst();
      return row !== undefined;
    },
  };
}
