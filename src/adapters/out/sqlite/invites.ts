// Invite links and posting permissions (spec 4, 7 Moderation). Only token hashes are stored; a
// permission belongs to a device or to the account logged in on it, goes with its holder (spec
// 3.7) and keeps a device from expiring early (3.10).
import type { InviteRepository, PermissionRepository } from "../../../application/ports.ts";
import type { Invite } from "../../../domain/invite.ts";
import type { Kysely } from "kysely";
import type { Database } from "./database.ts";
import type { DatabaseSchema, InvitesTable } from "./schema.ts";

const date = (value: string | null) => (value === null ? undefined : new Date(value));

const inviteOf = (row: Omit<InvitesTable, "token_hash" | "uses"> & { uses: number }): Invite => ({
  id: row.id,
  expiresAt: date(row.expires_at),
  maxUses: row.max_uses ?? undefined,
  uses: row.uses,
  revokedAt: date(row.revoked_at),
  createdAt: new Date(row.created_at),
});

const INVITE_COLUMNS = [
  "id",
  "expires_at",
  "max_uses",
  "uses",
  "revoked_at",
  "created_at",
] as const;

export function createInviteRepository(database: Database): InviteRepository {
  const { db } = database;
  return {
    async create(invite, tokenHash) {
      await db
        .insertInto("invites")
        .values({
          id: invite.id,
          token_hash: tokenHash,
          expires_at: invite.expiresAt?.toISOString() ?? null,
          max_uses: invite.maxUses ?? null,
          uses: invite.uses,
          revoked_at: invite.revokedAt?.toISOString() ?? null,
          created_at: invite.createdAt.toISOString(),
        })
        .execute();
    },

    async findByTokenHash(hash) {
      const row = await db
        .selectFrom("invites")
        .select(INVITE_COLUMNS)
        .where("token_hash", "=", hash)
        .executeTakeFirst();
      return row === undefined ? undefined : inviteOf(row);
    },

    async list() {
      const rows = await db
        .selectFrom("invites")
        .select(INVITE_COLUMNS)
        .orderBy("created_at", "desc")
        .orderBy("id", "desc")
        .execute();
      return rows.map(inviteOf);
    },

    async revoke(id, at) {
      await db
        .updateTable("invites")
        .set({ revoked_at: at.toISOString() })
        .where("id", "=", id)
        .where("revoked_at", "is", null)
        .execute();
      const row = await db
        .selectFrom("invites")
        .select("id")
        .where("id", "=", id)
        .executeTakeFirst();
      return row !== undefined;
    },

    async redeem({ inviteId, deviceId, permissionId, now }) {
      const at = now.toISOString();
      return db.transaction().execute(async (trx) => {
        if ((await mayPostRow(trx, deviceId)) !== undefined) return "already_allowed";
        // Counts the use only while the invite is usable (domain inviteState), in the same step.
        const used = await trx
          .updateTable("invites")
          .set((eb) => ({ uses: eb("uses", "+", 1) }))
          .where("id", "=", inviteId)
          .where("revoked_at", "is", null)
          .where((eb) => eb.or([eb("expires_at", "is", null), eb("expires_at", ">", at)]))
          .where((eb) => eb.or([eb("max_uses", "is", null), eb("uses", "<", eb.ref("max_uses"))]))
          .executeTakeFirst();
        if (Number(used.numUpdatedRows) === 0) return "unusable";
        // A logged-in device's permission goes to its account, and so to its other devices.
        const device = await trx
          .selectFrom("devices")
          .select("identity_id")
          .where("id", "=", deviceId)
          .executeTakeFirst();
        const identityId = device?.identity_id ?? null;
        await trx
          .insertInto("permissions")
          .values({
            id: permissionId,
            device_id: identityId === null ? deviceId : null,
            identity_id: identityId,
            permission: "may_post",
            invite_id: inviteId,
            created_at: at,
          })
          .execute();
        return "granted";
      });
    },
  };
}

/** The earliest `may_post` of the device itself or of the account logged in on it. */
const mayPostRow = (db: Kysely<DatabaseSchema>, deviceId: string) =>
  db
    .selectFrom("permissions")
    .select("created_at")
    .where("permission", "=", "may_post")
    .where((eb) =>
      eb.or([
        eb("device_id", "=", deviceId),
        eb(
          "identity_id",
          "=",
          eb.selectFrom("devices").select("identity_id").where("id", "=", deviceId),
        ),
      ]),
    )
    .orderBy("created_at")
    .executeTakeFirst();

export function createPermissionRepository(database: Database): PermissionRepository {
  return {
    async mayPostSince(deviceId) {
      const row = await mayPostRow(database.db, deviceId);
      return row === undefined ? undefined : new Date(row.created_at);
    },

    async accountMayPostSince(identityId) {
      const row = await database.db
        .selectFrom("permissions")
        .select("created_at")
        .where("permission", "=", "may_post")
        .where("identity_id", "=", identityId)
        .executeTakeFirst();
      return row === undefined ? undefined : new Date(row.created_at);
    },

    async deviceMayPostSince(deviceId) {
      const row = await database.db
        .selectFrom("permissions")
        .select("created_at")
        .where("permission", "=", "may_post")
        .where("device_id", "=", deviceId)
        .executeTakeFirst();
      return row === undefined ? undefined : new Date(row.created_at);
    },
  };
}
