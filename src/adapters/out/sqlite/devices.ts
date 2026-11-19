// Devices and their links (spec 3.2). Only token hashes are stored.
import type {
  ClaimCounts,
  DeviceLinkTarget,
  DeviceRepository,
} from "../../../application/ports.ts";
import { type Kysely, sql } from "kysely";
import { accessSource } from "./access.ts";
import { checkpoint, type Database } from "./database.ts";
import type { DatabaseSchema } from "./schema.ts";

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

/** What claiming moves (step 5a): plans hosted, responses managed, templates. */
const CLAIMS = [
  { count: "plans", role: "host", table: "plans", owner: "owner_identity_id", link: "plan_id" },
  {
    count: "responses",
    role: "manage",
    table: "responses",
    owner: "identity_id",
    link: "response_id",
  },
  {
    count: "templates",
    role: "template",
    table: "plan_templates",
    owner: "owner_identity_id",
    link: "template_id",
  },
] as const;

/**
 * IDs the device links to in this role that no account owns yet, and that would not give the
 * account a second role on a plan: no plan it responded to, no response to a plan it owns or
 * already responded to (spec 3.2: one response per plan; the host does not respond).
 */
async function claimableIds(
  db: Kysely<DatabaseSchema>,
  deviceId: string,
  identityId: string | null,
  claim: (typeof CLAIMS)[number],
): Promise<string[]> {
  const links = db
    .selectFrom("device_links")
    .where("device_links.device_id", "=", deviceId)
    .where("device_links.role", "=", claim.role);
  let rows: { id: string }[];
  switch (claim.table) {
    case "plans":
      rows = await links
        .innerJoin("plans", "plans.id", "device_links.plan_id")
        .select("plans.id")
        .where("plans.owner_identity_id", "is", null)
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom("responses as answer")
                .select("answer.id")
                .whereRef("answer.plan_id", "=", "plans.id")
                .where("answer.identity_id", "=", identityId),
            ),
          ),
        )
        .execute();
      break;
    case "responses":
      rows = await links
        .innerJoin("responses", "responses.id", "device_links.response_id")
        .select("responses.id")
        .where("responses.identity_id", "is", null)
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom("plans as hosted")
                .select("hosted.id")
                .whereRef("hosted.id", "=", "responses.plan_id")
                .where("hosted.owner_identity_id", "=", identityId),
            ),
          ),
        )
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom("responses as answer")
                .select("answer.id")
                .whereRef("answer.plan_id", "=", "responses.plan_id")
                .where("answer.identity_id", "=", identityId),
            ),
          ),
        )
        .execute();
      break;
    case "plan_templates":
      rows = await links
        .innerJoin("plan_templates", "plan_templates.id", "device_links.template_id")
        .select("plan_templates.id")
        .where("plan_templates.owner_identity_id", "is", null)
        .execute();
      break;
  }
  return rows.map((row) => row.id);
}

const NOTHING: ClaimCounts = { plans: 0, responses: 0, templates: 0 };

/** The account the device is logged in to, if any. */
const identityOf = async (db: Kysely<DatabaseSchema>, deviceId: string) =>
  (
    await db
      .selectFrom("devices")
      .select("identity_id")
      .where("id", "=", deviceId)
      .executeTakeFirst()
  )?.identity_id ?? null;

export function createDeviceRepository(database: Database): DeviceRepository {
  const find = async (column: "id" | "token_hash", value: string) => {
    const row = await database.db
      .selectFrom("devices")
      .select(["id", "last_seen_at", "identity_id"])
      .where(column, "=", value)
      .executeTakeFirst();
    return row === undefined
      ? undefined
      : {
          id: row.id,
          lastSeenAt: new Date(row.last_seen_at),
          identityId: row.identity_id ?? undefined,
        };
  };
  return {
    findByTokenHash: (hash) => find("token_hash", hash),
    findById: (id) => find("id", id),

    async create({ id, tokenHash, now }) {
      const at = now.toISOString();
      await database.db
        .insertInto("devices")
        .values({ id, token_hash: tokenHash, created_at: at, last_seen_at: at })
        .execute();
    },

    async touch(id, now) {
      const at = now.toISOString();
      await database.db
        .updateTable("devices")
        .set({ last_seen_at: at })
        .where("id", "=", id)
        .execute();
      // Using a logged-in device is using its account (spec 3.10).
      await database.db
        .updateTable("identities")
        .set({ last_active_at: at })
        .where("id", "=", (eb) =>
          eb.selectFrom("devices").select("identity_id").where("id", "=", id),
        )
        .execute();
    },

    async link(deviceId, target, now) {
      await database.db
        .insertInto("device_links")
        .values({ device_id: deviceId, ...columns(target), created_at: now.toISOString() })
        .onConflict((conflict) => conflict.doNothing())
        .execute();
    },

    async hasLink(deviceId, target, scope = "device_and_account") {
      // Its own links, its account's, or both (device_access, steps 5a, 5b).
      const source = accessSource(scope);
      const row = await database.db
        .selectFrom("device_access")
        .select("device_id")
        .where("device_id", "=", deviceId)
        .$if(source !== undefined, (query) => query.where("source", "=", source ?? "link"))
        .where("role", "=", target.role)
        .where(...targetEquals(target))
        .executeTakeFirst();
      return row !== undefined;
    },

    async replaceToken(deviceId, tokenHash) {
      await database.db
        .updateTable("devices")
        .set({ token_hash: tokenHash })
        .where("id", "=", deviceId)
        .execute();
    },

    async lastHostName(deviceId) {
      const hosted = await database.db
        .selectFrom("device_links")
        .innerJoin("plans", "plans.id", "device_links.plan_id")
        .select("plans.poster_name as name")
        .where("device_links.device_id", "=", deviceId)
        // The table CHECKs already tie role to the target column; kept as extra safety.
        .where("device_links.role", "=", "host")
        .where(sql<boolean>`trim(plans.poster_name) <> ''`)
        .orderBy("plans.created_at", "desc")
        .orderBy("plans.id", "desc")
        .limit(1)
        .executeTakeFirst();
      if (hosted !== undefined) return hosted.name;
      const kept = await database.db
        .selectFrom("device_links")
        .innerJoin("plan_templates", "plan_templates.id", "device_links.template_id")
        .select("plan_templates.poster_name as name")
        .where("device_links.device_id", "=", deviceId)
        // The table CHECKs already tie role to the target column; kept as extra safety.
        .where("device_links.role", "=", "template")
        .where(sql<boolean>`trim(plan_templates.poster_name) <> ''`)
        .orderBy("plan_templates.updated_at", "desc")
        .orderBy("plan_templates.id", "desc")
        .limit(1)
        .executeTakeFirst();
      return kept?.name;
    },

    async claimable(deviceId) {
      const { db } = database;
      const identityId = await identityOf(db, deviceId);
      const counts = { ...NOTHING };
      for (const claim of CLAIMS) {
        counts[claim.count] = (await claimableIds(db, deviceId, identityId, claim)).length;
      }
      return counts;
    },

    async claimableIds(deviceId) {
      const { db } = database;
      const identityId = await identityOf(db, deviceId);
      const [plans, responses, templates] = await Promise.all(
        CLAIMS.map((claim) => claimableIds(db, deviceId, identityId, claim)),
      );
      return { plans: plans ?? [], responses: responses ?? [], templates: templates ?? [] };
    },

    async claimInto(deviceId, identityId) {
      return database.db.transaction().execute(async (trx) => {
        // Logged out or into another account a moment ago: nothing moves.
        if ((await identityOf(trx, deviceId)) !== identityId) return { ...NOTHING };
        const moved = { ...NOTHING };
        for (const claim of CLAIMS) {
          const ids = await claimableIds(trx, deviceId, identityId, claim);
          if (ids.length > 0) {
            await trx
              .updateTable(claim.table)
              .set({ [claim.owner]: identityId })
              .where("id", "in", ids)
              .execute();
            // This device reaches them through the account now; other devices keep their links.
            await trx
              .deleteFrom("device_links")
              .where("device_id", "=", deviceId)
              .where("role", "=", claim.role)
              .where(claim.link, "in", ids)
              .execute();
          }
          moved[claim.count] = ids.length;
        }
        return moved;
      });
    },

    async setIdentity(deviceId, identityId) {
      await database.db
        .updateTable("devices")
        .set({ identity_id: identityId ?? null })
        .where("id", "=", deviceId)
        .execute();
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
        // The kept device may reach the target through its account (device_access, step 5a).
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom("device_access as kept")
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
              // Logged in to an account counts as linked.
              eb("identity_id", "is", null),
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
