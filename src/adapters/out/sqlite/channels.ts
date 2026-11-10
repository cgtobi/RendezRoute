// Notification channels in SQLite (spec 4): subscriptions encrypted with the field cipher,
// deleted with their response or plan by the foreign keys.
import type { Selectable } from "kysely";
import type {
  ChannelOwner,
  ChannelRepository,
  FieldCipher,
  IdGenerator,
  NotificationChannel,
} from "../../../application/ports.ts";
import type { PushSubscription } from "../../../domain/push.ts";
import type { Database } from "./database.ts";
import type { NotificationChannelsTable } from "./schema.ts";

const CONFIG = "notification_channels.config";

export function createChannelRepository(
  database: Database,
  cipher: FieldCipher,
  ids: IdGenerator,
  now: () => Date,
): ChannelRepository {
  const { db } = database;

  const fromRow = (row: Selectable<NotificationChannelsTable>): NotificationChannel => ({
    id: row.id,
    owner:
      row.response_id !== null ? { responseId: row.response_id } : { planId: row.plan_id ?? "" },
    subscription: JSON.parse(cipher.decrypt(row.config_enc, CONFIG)) as PushSubscription,
  });

  const ownedBy = (owner: ChannelOwner) => {
    const query = db.selectFrom("notification_channels").selectAll();
    return "responseId" in owner
      ? query.where("response_id", "=", owner.responseId)
      : query.where("plan_id", "=", owner.planId);
  };

  const listFor = async (owner: ChannelOwner) =>
    (await ownedBy(owner).orderBy("created_at").orderBy("id").execute()).map(fromRow);

  const find = async (owner: ChannelOwner, endpoint: string) =>
    (await listFor(owner)).find((channel) => channel.subscription.endpoint === endpoint);

  return {
    async add(owner, subscription, deviceId) {
      const existing = await find(owner, subscription.endpoint);
      if (existing !== undefined) return existing.id;
      const id = ids.rowId();
      await db
        .insertInto("notification_channels")
        .values({
          id,
          response_id: "responseId" in owner ? owner.responseId : null,
          plan_id: "planId" in owner ? owner.planId : null,
          kind: "webpush",
          config_enc: cipher.encrypt(JSON.stringify(subscription), CONFIG),
          // The browser confirmed the subscription itself (spec 3.11: channels confirmed by their owner).
          verified: 1,
          created_at: now().toISOString(),
          device_id: deviceId ?? null,
        })
        .execute();
      return id;
    },

    async removeForDevice(deviceId, owners) {
      const responseIds = owners.flatMap((owner) =>
        "responseId" in owner ? [owner.responseId] : [],
      );
      const planIds = owners.flatMap((owner) => ("planId" in owner ? [owner.planId] : []));
      if (responseIds.length === 0 && planIds.length === 0) return;
      await db
        .deleteFrom("notification_channels")
        .where("device_id", "=", deviceId)
        .where((eb) =>
          eb.or([
            ...(responseIds.length > 0 ? [eb("response_id", "in", responseIds)] : []),
            ...(planIds.length > 0 ? [eb("plan_id", "in", planIds)] : []),
          ]),
        )
        .execute();
    },

    async remove(owner, endpoint) {
      const existing = await find(owner, endpoint);
      if (existing !== undefined) await this.delete(existing.id);
    },

    async has(owner, endpoint) {
      return (await find(owner, endpoint)) !== undefined;
    },

    listFor,

    async findById(id) {
      const row = await db
        .selectFrom("notification_channels")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      return row === undefined ? undefined : fromRow(row);
    },

    async delete(id) {
      await db.deleteFrom("notification_channels").where("id", "=", id).execute();
    },
  };
}
