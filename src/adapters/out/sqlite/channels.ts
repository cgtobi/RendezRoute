// Notification channels in SQLite (spec 4): push subscriptions, email addresses and ntfy topics
// encrypted with the field cipher, deleted with their response, plan or account by the foreign keys.
import type { Selectable } from "kysely";
import type {
  ChannelOwner,
  ChannelRepository,
  ConfirmableChannel,
  EmailChannel,
  FieldCipher,
  IdGenerator,
  NotificationChannel,
  NtfyChannel,
  PushChannel,
  TelegramChannel,
} from "../../../application/ports.ts";
import type { PushSubscription } from "../../../domain/push.ts";
import type { Database } from "./database.ts";
import type { NotificationChannelsTable } from "./schema.ts";

const CONFIG = "notification_channels.config";

/** Exactly one owner column is set (the table's check). */
function ownerOf(row: Selectable<NotificationChannelsTable>): ChannelOwner {
  if (row.response_id !== null) return { responseId: row.response_id };
  if (row.plan_id !== null) return { planId: row.plan_id };
  if (row.identity_id !== null) return { identityId: row.identity_id };
  throw new Error("Notification channel without an owner.");
}

/** The one column that names this owner, and its value. */
const ownerColumn = (owner: ChannelOwner) =>
  "responseId" in owner
    ? (["response_id", owner.responseId] as const)
    : "planId" in owner
      ? (["plan_id", owner.planId] as const)
      : (["identity_id", owner.identityId] as const);

/** The owner as the row's three owner columns: its own set, the others null. */
const ownerColumns = (owner: ChannelOwner) => {
  const [column, value] = ownerColumn(owner);
  return { response_id: null, plan_id: null, identity_id: null, [column]: value };
};

export function createChannelRepository(
  database: Database,
  cipher: FieldCipher,
  ids: IdGenerator,
  now: () => Date,
): ChannelRepository {
  const { db } = database;

  const fromRow = (row: Selectable<NotificationChannelsTable>): NotificationChannel => {
    const base = { id: row.id, owner: ownerOf(row), verified: row.verified === 1 };
    const config = JSON.parse(cipher.decrypt(row.config_enc, CONFIG)) as unknown;
    if (row.kind === "webpush") {
      return { ...base, kind: "webpush", subscription: config as PushSubscription };
    }
    if (row.kind === "ntfy") {
      const { topic, server, language } = config as {
        topic: string;
        server?: string;
        language?: string;
      };
      return { ...base, kind: "ntfy", topic, server: server ?? "", language };
    }
    if (row.kind === "telegram") {
      const { chatId, language } = config as { chatId?: string; language?: string };
      return { ...base, kind: "telegram", chatId, language };
    }
    if (row.kind !== "email") throw new Error(`Unknown channel kind ${row.kind}.`);
    const { address, language } = config as { address: string; language?: string };
    return { ...base, kind: "email", address, language };
  };

  const pushChannels = async (owner: ChannelOwner) =>
    (await listFor(owner)).filter((channel): channel is PushChannel => channel.kind === "webpush");

  const ownedBy = (owner: ChannelOwner) => {
    const [column, value] = ownerColumn(owner);
    return db.selectFrom("notification_channels").selectAll().where(column, "=", value);
  };

  const listFor = async (owner: ChannelOwner) =>
    (await ownedBy(owner).orderBy("created_at").orderBy("id").execute()).map(fromRow);

  const find = async (owner: ChannelOwner, endpoint: string) =>
    (await pushChannels(owner)).find((channel) => channel.subscription.endpoint === endpoint);

  /** An owner has one channel of each confirmable kind: a new one replaces it, unconfirmed. */
  const replace = async (
    owner: ChannelOwner,
    kind: ConfirmableChannel["kind"],
    config: Record<string, string | undefined>,
  ) => {
    const id = ids.rowId();
    const [column, value] = ownerColumn(owner);
    await db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom("notification_channels")
        .where("kind", "=", kind)
        .where(column, "=", value)
        .execute();
      await trx
        .insertInto("notification_channels")
        .values({
          id,
          ...ownerColumns(owner),
          kind,
          config_enc: cipher.encrypt(JSON.stringify(config), CONFIG),
          verified: 0,
          created_at: now().toISOString(),
        })
        .execute();
    });
    return id;
  };

  const emailFor = async (owner: ChannelOwner) =>
    (await listFor(owner)).find((channel): channel is EmailChannel => channel.kind === "email");

  return {
    async add(owner, subscription, deviceId) {
      const existing = await find(owner, subscription.endpoint);
      if (existing !== undefined) return existing.id;
      const id = ids.rowId();
      await db
        .insertInto("notification_channels")
        .values({
          id,
          ...ownerColumns(owner),
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

    setEmail: (owner, address, language) => replace(owner, "email", { address, language }),

    setNtfy: (owner, { topic, server }, language) =>
      replace(owner, "ntfy", { topic, server, language }),

    setTelegram: (owner, language) => replace(owner, "telegram", { language }),

    async telegramFor(owner) {
      return (await listFor(owner)).find(
        (channel): channel is TelegramChannel => channel.kind === "telegram",
      );
    },

    async attachTelegramChat(id, chatId) {
      const row = await db
        .selectFrom("notification_channels")
        .selectAll()
        .where("id", "=", id)
        .where("kind", "=", "telegram")
        .executeTakeFirst();
      if (row === undefined) return false;
      const config = JSON.parse(cipher.decrypt(row.config_enc, CONFIG)) as Record<string, string>;
      await db
        .updateTable("notification_channels")
        .set({
          config_enc: cipher.encrypt(JSON.stringify({ ...config, chatId }), CONFIG),
          verified: 1,
        })
        .where("id", "=", id)
        .execute();
      return true;
    },

    async ntfyFor(owner) {
      return (await listFor(owner)).find(
        (channel): channel is NtfyChannel => channel.kind === "ntfy",
      );
    },

    async confirm(id) {
      const result = await db
        .updateTable("notification_channels")
        .set({ verified: 1 })
        .where("id", "=", id)
        .executeTakeFirst();
      return result.numUpdatedRows > 0n;
    },

    emailFor,
  };
}
