// Template persistence (spec 4, 3.10 Templates). Exact start and route pass through FieldCipher.
import { accessSource } from "./access.ts";
import { shareButtonsFromText, shareButtonsToText } from "./share-buttons.ts";
import type { Insertable, Selectable, Transaction } from "kysely";
import type { FieldCipher, NewTemplate, TemplateRepository } from "../../../application/ports.ts";
import type { Route } from "../../../domain/route.ts";
import type { PlanTemplate } from "../../../domain/template.ts";
import { checkpoint, type Database } from "./database.ts";
import { fromGeoJson, toGeoJson } from "./geojson.ts";
import type { DatabaseSchema, PlanTemplatesTable } from "./schema.ts";
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

const EXACT_START = "plan_templates.exact_location" as const;
const ROUTE = "plan_templates.route_geojson" as const;

type Row = Omit<
  Insertable<PlanTemplatesTable>,
  "id" | "host_token_hash" | "route_geojson_enc" | "creation_nonce"
>;

function toRow(cipher: FieldCipher, template: PlanTemplate): Row {
  return {
    poster_name: template.posterName,
    poster_language: template.posterLanguage,
    timezone: template.timeZone,
    start_time: template.startTime,
    activity_type: template.activity,
    title: template.title,
    note: template.note ?? null,
    ...areaColumns(template.area),
    exact_location_enc: encryptExactStart(cipher, template.exactStart, EXACT_START),
    distance_m: template.distanceMeters ?? null,
    elevation_gain_m: template.elevationGainMeters ?? null,
    ...paceColumns(template.pace),
    drop_policy: template.dropPolicy,
    share_buttons: shareButtonsToText(template.shareButtons),
    primary_color: template.colors.primary,
    secondary_color: template.colors.secondary,
    visibility: template.visibility,
    join_mode: template.joinMode,
    recap_window: template.recapWindow,
    retention_days: template.retentionDays,
    last_used_at: iso(template.lastUsedAt),
    expires_at: iso(template.expiresAt),
    created_at: iso(template.createdAt),
    updated_at: iso(template.updatedAt),
  };
}

const encryptRoute = (cipher: FieldCipher, route: Route) =>
  cipher.encrypt(JSON.stringify(toGeoJson(route)), ROUTE);

/**
 * Stores a template and links the plan's host devices to it. Runs inside the caller's
 * transaction, so a plan deleted with its template kept is never half done.
 */
export async function insertTemplate(
  trx: Transaction<DatabaseSchema>,
  cipher: FieldCipher,
  { template, hostTokenHash, route, hostsOfPlan, creationNonce, ownerIdentityId }: NewTemplate,
): Promise<void> {
  await trx
    .insertInto("plan_templates")
    .values({
      id: template.id,
      host_token_hash: hostTokenHash ?? null,
      ...toRow(cipher, template),
      route_geojson_enc: route === undefined ? null : encryptRoute(cipher, route),
      creation_nonce: creationNonce ?? null,
      // Saved while logged in: the account's; else that of the plan's account, if any (D25).
      owner_identity_id:
        ownerIdentityId ??
        ((eb) => eb.selectFrom("plans").select("owner_identity_id").where("id", "=", hostsOfPlan)),
    })
    .execute();
  await trx
    .insertInto("device_links")
    .columns(["device_id", "role", "template_id", "created_at"])
    .expression((eb) =>
      eb
        .selectFrom("device_links")
        .select((s) => [
          "device_id",
          s.val("template").as("role"),
          s.val(template.id).as("template_id"),
          s.val(iso(template.createdAt)).as("created_at"),
        ])
        .where("plan_id", "=", hostsOfPlan)
        .where("role", "=", "host"),
    )
    .execute();
}

export function createTemplateRepository(
  database: Database,
  cipher: FieldCipher,
): TemplateRepository {
  const fromRow = (row: Selectable<PlanTemplatesTable>): PlanTemplate => ({
    id: row.id,
    posterName: row.poster_name,
    posterLanguage: row.poster_language,
    timeZone: row.timezone,
    startTime: row.start_time,
    activity: row.activity_type,
    title: row.title,
    note: row.note ?? undefined,
    area: areaFrom(row),
    exactStart: decryptExactStart(cipher, row.exact_location_enc, EXACT_START),
    hasRoute: row.route_geojson_enc !== null,
    distanceMeters: row.distance_m ?? undefined,
    elevationGainMeters: row.elevation_gain_m ?? undefined,
    pace: paceFrom(row),
    dropPolicy: row.drop_policy,
    shareButtons: shareButtonsFromText(row.share_buttons),
    joinMode: row.join_mode,
    visibility: row.visibility,
    colors: colorsFrom(row),
    retentionDays: row.retention_days,
    recapWindow: row.recap_window,
    lastUsedAt: new Date(row.last_used_at),
    expiresAt: new Date(row.expires_at),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });

  const deleted = (count: bigint | number): number => {
    const n = Number(count);
    // Deleted content also leaves the WAL (spec 3.10).
    if (n > 0) checkpoint(database);
    return n;
  };

  return {
    async create(input) {
      await database.db.transaction().execute((trx) => insertTemplate(trx, cipher, input));
    },

    async findById(id) {
      const row = await database.db
        .selectFrom("plan_templates")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      return row === undefined ? undefined : fromRow(row);
    },

    async findByHostTokenHash(hash) {
      const row = await database.db
        .selectFrom("plan_templates")
        .selectAll()
        .where("host_token_hash", "=", hash)
        .executeTakeFirst();
      return row === undefined ? undefined : fromRow(row);
    },

    async findIdByCreationNonce(nonce) {
      const row = await database.db
        .selectFrom("plan_templates")
        .select("id")
        .where("creation_nonce", "=", nonce)
        .executeTakeFirst();
      return row?.id;
    },

    async setHostTokenHash(templateId, hash) {
      await database.db
        .updateTable("plan_templates")
        .set({ host_token_hash: hash })
        .where("id", "=", templateId)
        .execute();
    },

    async update(template) {
      const { created_at: _createdAt, ...fields } = toRow(cipher, template);
      await database.db
        .updateTable("plan_templates")
        .set(fields)
        .where("id", "=", template.id)
        .execute();
    },

    async markUsed(id, lastUsedAt, expiresAt) {
      await database.db
        .updateTable("plan_templates")
        .set({
          last_used_at: iso(lastUsedAt),
          expires_at: iso(expiresAt),
          updated_at: iso(lastUsedAt),
        })
        .where("id", "=", id)
        .execute();
    },

    async findRoute(id) {
      const row = await database.db
        .selectFrom("plan_templates")
        .select("route_geojson_enc")
        .where("id", "=", id)
        .executeTakeFirst();
      return row === undefined || row.route_geojson_enc === null
        ? undefined
        : fromGeoJson(JSON.parse(cipher.decrypt(row.route_geojson_enc, ROUTE)));
    },

    async deleteRoute(id) {
      await database.db
        .updateTable("plan_templates")
        .set({ route_geojson_enc: null })
        .where("id", "=", id)
        .execute();
      checkpoint(database);
    },

    async delete(id) {
      const result = await database.db
        .deleteFrom("plan_templates")
        .where("id", "=", id)
        .executeTakeFirst();
      deleted(result.numDeletedRows);
    },

    async listForDevice(deviceId, scope) {
      const rows = await database.db
        .selectFrom("plan_templates")
        .innerJoin("device_access as link", "link.template_id", "plan_templates.id")
        .selectAll("plan_templates")
        .distinct()
        .where("link.device_id", "=", deviceId)
        .$if(accessSource(scope) !== undefined, (query) =>
          query.where("link.source", "=", accessSource(scope) ?? "link"),
        )
        .orderBy("plan_templates.title")
        .orderBy("plan_templates.id")
        .execute();
      return rows.map(fromRow);
    },

    async listOwnedBy(identityId) {
      const rows = await database.db
        .selectFrom("plan_templates")
        .selectAll()
        .where("owner_identity_id", "=", identityId)
        .orderBy("title")
        .orderBy("id")
        .execute();
      return rows.map(fromRow);
    },

    async deleteExpired(now) {
      const result = await database.db
        .deleteFrom("plan_templates")
        .where("expires_at", "<=", iso(now))
        .executeTakeFirst();
      return deleted(result.numDeletedRows);
    },
  };
}
