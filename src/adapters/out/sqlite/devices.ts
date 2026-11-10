// Devices and their links (spec 3.2). Only token hashes are stored.
import type { DeviceLinkTarget, DeviceRepository } from "../../../application/ports.ts";
import { checkpoint, type Database } from "./database.ts";

/** The column and value that identify a link's target. */
const targetOf = (target: DeviceLinkTarget) => {
  switch (target.role) {
    case "host":
      return ["plan_id", target.planId] as const;
    case "manage":
      return ["response_id", target.responseId] as const;
    case "template":
      return ["template_id", target.templateId] as const;
  }
};

const targetEquals = (target: DeviceLinkTarget) => {
  const [column, id] = targetOf(target);
  return [column, "=", id] as const;
};

const columns = (target: DeviceLinkTarget) => {
  const [column, id] = targetOf(target);
  return { plan_id: null, response_id: null, template_id: null, role: target.role, [column]: id };
};

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
        .where(...targetEquals(target))
        .executeTakeFirst();
      return row !== undefined;
    },

    async delete(id) {
      await database.db.deleteFrom("devices").where("id", "=", id).execute();
      checkpoint(database);
    },

    async unlinkOthers(target, keepDeviceId) {
      const result = await database.db
        .deleteFrom("device_links")
        .where("role", "=", target.role)
        .where(...targetEquals(target))
        .where("device_id", "!=", keepDeviceId)
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom("device_links as kept")
              .select("kept.device_id")
              .where("kept.device_id", "=", keepDeviceId)
              .where("kept.role", "=", target.role)
              .where(`kept.${targetOf(target)[0]}`, "=", targetOf(target)[1]),
          ),
        )
        .executeTakeFirst();
      return Number(result.numDeletedRows);
    },

    async deleteInactive({ unlinkedLastSeenBefore, anyLastSeenBefore }) {
      const result = await database.db
        .deleteFrom("devices")
        .where((eb) =>
          eb.or([
            eb("last_seen_at", "<", anyLastSeenBefore.toISOString()),
            eb.and([
              eb("last_seen_at", "<", unlinkedLastSeenBefore.toISOString()),
              eb.not(
                eb.exists(
                  eb
                    .selectFrom("device_links")
                    .select("device_id")
                    .whereRef("device_links.device_id", "=", "devices.id"),
                ),
              ),
              // A permission counts as a link (spec 3.10 Other expiry).
              eb.not(
                eb.exists(
                  eb
                    .selectFrom("permissions")
                    .select("device_id")
                    .whereRef("permissions.device_id", "=", "devices.id"),
                ),
              ),
            ]),
          ]),
        )
        .executeTakeFirst();
      const deleted = Number(result.numDeletedRows);
      if (deleted > 0) checkpoint(database);
      return deleted;
    },
  };
}
