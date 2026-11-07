// Devices and their links (spec 3.2). Only token hashes are stored.
import type { DeviceLinkTarget, DeviceRepository } from "../../../application/ports.ts";
import type { Database } from "./database.ts";

const columns = (target: DeviceLinkTarget) =>
  target.role === "host"
    ? { role: "host" as const, plan_id: target.planId, response_id: null }
    : { role: "manage" as const, plan_id: null, response_id: target.responseId };

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

    async link(deviceId, target, now) {
      await database.db
        .insertInto("device_links")
        .values({ device_id: deviceId, ...columns(target), created_at: now.toISOString() })
        .onConflict((conflict) => conflict.doNothing())
        .execute();
    },

    async hasLink(deviceId, target) {
      const row = await database.db
        .selectFrom("device_links")
        .select("device_id")
        .where("device_id", "=", deviceId)
        .where("role", "=", target.role)
        .where(
          target.role === "host" ? "plan_id" : "response_id",
          "=",
          target.role === "host" ? target.planId : target.responseId,
        )
        .executeTakeFirst();
      return row !== undefined;
    },
  };
}
