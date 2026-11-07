// Plan persistence (spec 4). The exact start passes through FieldCipher; Kysely and
// row types stay inside this adapter (spec 2a).
import type { Insertable, Selectable } from "kysely";
import type { FieldCipher, PlanRepository } from "../../../application/ports.ts";
import { type HexColor, parseHexColor } from "../../../domain/color.ts";
import type { ExactStart } from "../../../domain/geo.ts";
import type { Plan } from "../../../domain/plan.ts";
import type { Database } from "./database.ts";
import type { PlansTable } from "./schema.ts";

const EXACT_START = "plans.exact_location" as const;

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

  const fromRow = (row: Selectable<PlansTable>): Plan => ({
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
    recapWindow: row.recap_window,
    retentionDays: row.retention_days,
    deleteAt: new Date(row.delete_at),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });

  return {
    async create({ plan, hostTokenHash, creationNonce, hostDeviceId }) {
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
      });
    },

    async findById(id) {
      const row = await database.db
        .selectFrom("plans")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      return row === undefined ? undefined : fromRow(row);
    },

    async findByHostTokenHash(hash) {
      const row = await database.db
        .selectFrom("plans")
        .selectAll()
        .where("host_token_hash", "=", hash)
        .executeTakeFirst();
      return row === undefined ? undefined : fromRow(row);
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
