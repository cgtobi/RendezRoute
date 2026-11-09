// Plan persistence (spec 4). The exact start passes through FieldCipher; Kysely and
// row types stay inside this adapter (spec 2a).
import { type Insertable, type Selectable, sql } from "kysely";
import type {
  FieldCipher,
  LinkedPlan,
  NewTemplate,
  PlanRepository,
} from "../../../application/ports.ts";
import type { Plan } from "../../../domain/plan.ts";
import type { Route } from "../../../domain/route.ts";
import { checkpoint, type Database } from "./database.ts";
import {
  areaColumns,
  areaFrom,
  colorsFrom,
  decryptExactStart,
  encryptExactStart,
  iso,
  paceColumns,
  paceFrom,
} from "./shared-fields.ts";
import { fromGeoJson, toGeoJson } from "./geojson.ts";
import type { PlansTable } from "./schema.ts";
import { insertTemplate } from "./templates.ts";

const EXACT_START = "plans.exact_location" as const;
const ROUTE = "routes.geojson" as const;

const DELETE_CHUNK = 500;

export function createPlanRepository(database: Database, cipher: FieldCipher): PlanRepository {
  const toRow = (plan: Plan, hostTokenHash: string): Insertable<PlansTable> => ({
    id: plan.id,
    poster_name: plan.posterName,
    poster_language: plan.posterLanguage,
    activity_type: plan.activity,
    title: plan.title,
    note: plan.note ?? null,
    starts_at: iso(plan.startsAt),
    timezone: plan.timeZone,
    ...areaColumns(plan.area),
    exact_location_enc: encryptExactStart(cipher, plan.exactStart, EXACT_START),
    distance_m: plan.distanceMeters ?? null,
    elevation_gain_m: plan.elevationGainMeters ?? null,
    ...paceColumns(plan.pace),
    drop_policy: plan.dropPolicy,
    primary_color: plan.colors.primary,
    secondary_color: plan.colors.secondary,
    visibility: plan.visibility,
    join_mode: plan.joinMode,
    status: plan.status,
    recap_window: plan.recapWindow,
    recap_window_set_at: plan.recapWindowSetAt === undefined ? null : iso(plan.recapWindowSetAt),
    recap_closed_at: plan.recapClosedAt === undefined ? null : iso(plan.recapClosedAt),
    ratings_closed_at: plan.ratingsClosedAt === undefined ? null : iso(plan.ratingsClosedAt),
    retention_days: plan.retentionDays,
    delete_at: iso(plan.deleteAt),
    keep_as_template: plan.template.keep ? 1 : 0,
    template_include_private: plan.template.includePrivate ? 1 : 0,
    host_token_hash: hostTokenHash,
    created_at: iso(plan.createdAt),
    updated_at: iso(plan.updatedAt),
  });

  const fromRow = (row: Selectable<PlansTable> & { has_route: unknown }): Plan => ({
    id: row.id,
    posterName: row.poster_name,
    posterLanguage: row.poster_language,
    activity: row.activity_type,
    title: row.title,
    note: row.note ?? undefined,
    startsAt: new Date(row.starts_at),
    timeZone: row.timezone,
    area: areaFrom(row),
    exactStart: decryptExactStart(cipher, row.exact_location_enc, EXACT_START),
    distanceMeters: row.distance_m ?? undefined,
    elevationGainMeters: row.elevation_gain_m ?? undefined,
    pace: paceFrom(row),
    dropPolicy: row.drop_policy,
    colors: colorsFrom(row),
    visibility: row.visibility,
    joinMode: row.join_mode,
    status: row.status,
    hasRoute: Boolean(row.has_route),
    recapWindow: row.recap_window,
    recapWindowSetAt:
      row.recap_window_set_at === null ? undefined : new Date(row.recap_window_set_at),
    recapClosedAt: row.recap_closed_at === null ? undefined : new Date(row.recap_closed_at),
    ratingsClosedAt: row.ratings_closed_at === null ? undefined : new Date(row.ratings_closed_at),
    retentionDays: row.retention_days,
    deleteAt: new Date(row.delete_at),
    template: {
      keep: row.keep_as_template === 1,
      includePrivate: row.keep_as_template === 1 && row.template_include_private === 1,
    },
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });

  /** Plans with a has_route flag; the route itself is loaded only by findRoute. */
  const selectPlans = () =>
    database.db
      .selectFrom("plans")
      .selectAll("plans")
      .select((eb) =>
        eb
          .exists(
            eb.selectFrom("routes").select("routes.id").whereRef("routes.plan_id", "=", "plans.id"),
          )
          .as("has_route"),
      );

  const encryptRoute = (route: Route) => cipher.encrypt(JSON.stringify(toGeoJson(route)), ROUTE);

  const deleteMany = async (
    ids: readonly string[],
    templates: readonly NewTemplate[] = [],
  ): Promise<void> => {
    if (ids.length === 0) return;
    await database.db.transaction().execute(async (trx) => {
      // Kept templates first: their host devices are copied from the plans' links (spec 3.10).
      for (const template of templates) await insertTemplate(trx, cipher, template);
      // Chunks stay far below SQLite's limit of 32,766 parameters per statement.
      for (let start = 0; start < ids.length; start += DELETE_CHUNK) {
        // Responses, device links and creation nonces go with them (on delete cascade).
        await trx
          .deleteFrom("plans")
          .where("id", "in", ids.slice(start, start + DELETE_CHUNK))
          .execute();
      }
    });
    // Deleted content also leaves the WAL (spec 3.10, decision D8).
    checkpoint(database);
  };

  return {
    async create({ plan, hostTokenHash, creationNonce, hostDeviceId, route }) {
      const createdAt = iso(plan.createdAt);
      await database.db.transaction().execute(async (trx) => {
        await trx.insertInto("plans").values(toRow(plan, hostTokenHash)).execute();
        await trx
          .insertInto("plan_creation_nonces")
          .values({ nonce: creationNonce, plan_id: plan.id, created_at: createdAt })
          .execute();
        await trx
          .insertInto("device_links")
          .values({
            device_id: hostDeviceId,
            role: "host",
            plan_id: plan.id,
            created_at: createdAt,
          })
          .execute();
        if (route !== undefined) {
          // One route per plan, so the plan ID doubles as the route ID.
          await trx
            .insertInto("routes")
            .values({ id: plan.id, plan_id: plan.id, geojson_enc: encryptRoute(route) })
            .execute();
        }
      });
    },

    async findById(id) {
      const row = await selectPlans().where("plans.id", "=", id).executeTakeFirst();
      return row === undefined ? undefined : fromRow(row);
    },

    async findByHostTokenHash(hash) {
      const row = await selectPlans().where("plans.host_token_hash", "=", hash).executeTakeFirst();
      return row === undefined ? undefined : fromRow(row);
    },

    async setHostTokenHash(planId, hash) {
      await database.db
        .updateTable("plans")
        .set({ host_token_hash: hash })
        .where("id", "=", planId)
        .execute();
    },

    async update(plan) {
      const {
        id,
        host_token_hash: _hostTokenHash,
        created_at: _createdAt,
        ...fields
      } = toRow(plan, "");
      await database.db.updateTable("plans").set(fields).where("id", "=", id).execute();
    },

    delete: (id) => deleteMany([id]),

    deleteMany,

    async findDueForDeletion(now) {
      const rows = await selectPlans().where("plans.delete_at", "<=", now.toISOString()).execute();
      return rows.map(fromRow);
    },

    async findActiveStartingBetween(from, to) {
      const rows = await selectPlans()
        .where("plans.status", "=", "active")
        .where("plans.starts_at", ">=", from.toISOString())
        .where("plans.starts_at", "<=", to.toISOString())
        .execute();
      return rows.map(fromRow);
    },

    async findActiveDeletingBetween(from, to) {
      const rows = await selectPlans()
        .where("plans.status", "=", "active")
        .where("plans.delete_at", ">=", from.toISOString())
        .where("plans.delete_at", "<=", to.toISOString())
        .execute();
      return rows.map(fromRow);
    },

    async findLinkedToDevice(deviceId) {
      const rows = await selectPlans()
        .innerJoin("device_links", (join) =>
          join.on((eb) =>
            eb.or([
              eb("device_links.plan_id", "=", eb.ref("plans.id")),
              eb.exists(
                eb
                  .selectFrom("responses")
                  .select("responses.id")
                  .whereRef("responses.id", "=", "device_links.response_id")
                  .whereRef("responses.plan_id", "=", "plans.id"),
              ),
            ]),
          ),
        )
        .leftJoin("responses as own", "own.id", "device_links.response_id")
        .select(["device_links.role as link_role", "own.kind as response_kind"])
        .where("device_links.device_id", "=", deviceId)
        .orderBy("plans.starts_at")
        .orderBy("device_links.role")
        .execute();
      return rows.map((row): LinkedPlan => {
        const plan = fromRow(row);
        return row.link_role === "manage" && row.response_kind !== null
          ? { plan, role: "manage", responseKind: row.response_kind }
          : { plan, role: "host" };
      });
    },

    async findWithRetentionAbove(maxRetentionDays) {
      const rows = await selectPlans()
        .where("plans.retention_days", ">", maxRetentionDays)
        .execute();
      return rows.map(fromRow);
    },

    async findRoute(planId) {
      const row = await database.db
        .selectFrom("routes")
        .select("geojson_enc")
        .where("plan_id", "=", planId)
        .executeTakeFirst();
      return row === undefined
        ? undefined
        : fromGeoJson(JSON.parse(cipher.decrypt(row.geojson_enc, ROUTE)));
    },

    async saveRoute(planId, route) {
      const geojson_enc = encryptRoute(route);
      await database.db
        .insertInto("routes")
        .values({ id: planId, plan_id: planId, geojson_enc })
        .onConflict((conflict) => conflict.column("plan_id").doUpdateSet({ geojson_enc }))
        .execute();
      // The replaced route's ciphertext also leaves the WAL.
      checkpoint(database);
    },

    async deleteRoute(planId) {
      await database.db.deleteFrom("routes").where("plan_id", "=", planId).execute();
      checkpoint(database);
    },

    async findPreview(planId, version) {
      const row = await database.db
        .selectFrom("plan_previews")
        .select("image")
        .where("plan_id", "=", planId)
        .where("version", "=", version)
        .executeTakeFirst();
      return row === undefined ? undefined : new Uint8Array(row.image);
    },

    async savePreview(planId, version, image) {
      // In one statement with the existence check, so a plan deleted meanwhile stores nothing.
      await sql`
        insert into plan_previews (plan_id, version, image)
        select ${planId}, ${version}, ${Buffer.from(image)}
        where exists (select 1 from plans where id = ${planId})
        on conflict (plan_id) do update set version = excluded.version, image = excluded.image
      `.execute(database.db);
    },

    async findIdByCreationNonce(nonce) {
      const row = await database.db
        .selectFrom("plan_creation_nonces")
        .select("plan_id")
        .where("nonce", "=", nonce)
        .executeTakeFirst();
      return row?.plan_id;
    },
  };
}
