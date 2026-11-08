// Plan persistence (spec 4). The exact start passes through FieldCipher; Kysely and
// row types stay inside this adapter (spec 2a).
import { type Insertable, type Selectable, sql } from "kysely";
import type { FieldCipher, PlanRepository } from "../../../application/ports.ts";
import { type HexColor, parseHexColor } from "../../../domain/color.ts";
import type { ExactStart } from "../../../domain/geo.ts";
import type { Plan } from "../../../domain/plan.ts";
import type { Route } from "../../../domain/route.ts";
import { checkpoint, type Database } from "./database.ts";
import type { PlansTable } from "./schema.ts";

const EXACT_START = "plans.exact_location" as const;
const ROUTE = "routes.geojson" as const;

type Position = [number, number] | [number, number, number];
interface MultiLineString {
  type: "MultiLineString";
  coordinates: Position[][];
}

/** GeoJSON order: [longitude, latitude, elevation?]. */
const toGeoJson = (route: Route): MultiLineString => ({
  type: "MultiLineString",
  coordinates: route.segments.map((segment) =>
    segment.map((p): Position => (p.ele === undefined ? [p.lng, p.lat] : [p.lng, p.lat, p.ele])),
  ),
});

const fromGeoJson = (geojson: MultiLineString): Route => ({
  segments: geojson.coordinates.map((line) =>
    line.map(([lng, lat, ele]) => (ele === undefined ? { lat, lng } : { lat, lng, ele })),
  ),
});
const DELETE_CHUNK = 500;

interface StoredExactStart {
  lat?: number;
  lng?: number;
  description?: string;
}

const iso = (date: Date) => date.toISOString();

function color(value: string): HexColor {
  const parsed = parseHexColor(value);
  if (!parsed.ok) throw new Error("Stored plan color is not a valid #RRGGBB value.");
  return parsed.value;
}

export function createPlanRepository(database: Database, cipher: FieldCipher): PlanRepository {
  const encryptExactStart = (exact: ExactStart | undefined): string | null => {
    if (exact === undefined) return null;
    const stored: StoredExactStart = {
      ...(exact.point === undefined ? {} : { lat: exact.point.lat, lng: exact.point.lng }),
      ...(exact.description === undefined ? {} : { description: exact.description }),
    };
    return cipher.encrypt(JSON.stringify(stored), EXACT_START);
  };

  const decryptExactStart = (value: string | null): ExactStart | undefined => {
    if (value === null) return undefined;
    const stored = JSON.parse(cipher.decrypt(value, EXACT_START)) as StoredExactStart;
    return {
      point:
        stored.lat === undefined || stored.lng === undefined
          ? undefined
          : { lat: stored.lat, lng: stored.lng },
      description: stored.description,
    };
  };

  const toRow = (plan: Plan, hostTokenHash: string): Insertable<PlansTable> => ({
    id: plan.id,
    poster_name: plan.posterName,
    poster_language: plan.posterLanguage,
    activity_type: plan.activity,
    title: plan.title,
    note: plan.note ?? null,
    starts_at: iso(plan.startsAt),
    timezone: plan.timeZone,
    area_label: plan.area.label,
    area_lat: plan.area.point?.lat ?? null,
    area_lng: plan.area.point?.lng ?? null,
    exact_location_enc: encryptExactStart(plan.exactStart),
    distance_m: plan.distanceMeters ?? null,
    elevation_gain_m: plan.elevationGainMeters ?? null,
    pace_min_s_per_km: plan.pace?.fastest ?? null,
    pace_max_s_per_km: plan.pace?.slowest ?? null,
    drop_policy: plan.dropPolicy,
    primary_color: plan.colors.primary,
    secondary_color: plan.colors.secondary,
    visibility: plan.visibility,
    join_mode: plan.joinMode,
    status: plan.status,
    recap_window: plan.recapWindow,
    retention_days: plan.retentionDays,
    delete_at: iso(plan.deleteAt),
    // Templates arrive in v0.5.
    keep_as_template: 0,
    template_include_private: 0,
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
    area: {
      label: row.area_label,
      point:
        row.area_lat === null || row.area_lng === null
          ? undefined
          : { lat: row.area_lat, lng: row.area_lng },
    },
    exactStart: decryptExactStart(row.exact_location_enc),
    distanceMeters: row.distance_m ?? undefined,
    elevationGainMeters: row.elevation_gain_m ?? undefined,
    pace:
      row.pace_min_s_per_km === null || row.pace_max_s_per_km === null
        ? undefined
        : { fastest: row.pace_min_s_per_km, slowest: row.pace_max_s_per_km },
    dropPolicy: row.drop_policy,
    colors: { primary: color(row.primary_color), secondary: color(row.secondary_color) },
    visibility: row.visibility,
    joinMode: row.join_mode,
    status: row.status,
    hasRoute: Boolean(row.has_route),
    recapWindow: row.recap_window,
    retentionDays: row.retention_days,
    deleteAt: new Date(row.delete_at),
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

  const deleteMany = async (ids: readonly string[]): Promise<void> => {
    if (ids.length === 0) return;
    await database.db.transaction().execute(async (trx) => {
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
      const rows = await database.db
        .selectFrom("plans")
        .select("id")
        .where("delete_at", "<=", now.toISOString())
        .execute();
      return rows.map((row) => row.id);
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
