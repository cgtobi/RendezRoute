// Response persistence (spec 3.5, 4). Display names pass through FieldCipher.
import type { Selectable } from "kysely";
import type { FieldCipher, ResponseRepository } from "../../../application/ports.ts";
import type { PlanResponse } from "../../../domain/response.ts";
import { checkpoint, type Database } from "./database.ts";
import type { ResponsesTable } from "./schema.ts";

const DISPLAY_NAME = "responses.display_name" as const;
const REQUEST_NOTE = "responses.request_note" as const;

export function createResponseRepository(
  database: Database,
  cipher: FieldCipher,
): ResponseRepository {
  const fromRow = (row: Selectable<ResponsesTable>): PlanResponse => ({
    id: row.id,
    planId: row.plan_id,
    kind: row.kind,
    displayName: cipher.decrypt(row.display_name_enc, DISPLAY_NAME),
    requestNote:
      row.request_note_enc === null
        ? undefined
        : cipher.decrypt(row.request_note_enc, REQUEST_NOTE),
    language: row.language,
    previousKind: row.previous_kind ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });

  const encryptNote = (note: string | undefined) =>
    note === undefined ? null : cipher.encrypt(note, REQUEST_NOTE);

  const selectResponses = () => database.db.selectFrom("responses").selectAll("responses");

  return {
    async create({ response, manageTokenHash, creationNonce, deviceId }) {
      await database.db.transaction().execute(async (trx) => {
        await trx
          .insertInto("responses")
          .values({
            id: response.id,
            plan_id: response.planId,
            kind: response.kind,
            display_name_enc: cipher.encrypt(response.displayName, DISPLAY_NAME),
            request_note_enc: encryptNote(response.requestNote),
            manage_token_hash: manageTokenHash,
            device_id: deviceId ?? null,
            language: response.language,
            previous_kind: response.previousKind ?? null,
            creation_nonce: creationNonce,
            created_at: response.createdAt.toISOString(),
            updated_at: response.updatedAt.toISOString(),
          })
          .execute();
        if (deviceId !== undefined) {
          await trx
            .insertInto("device_links")
            .values({
              device_id: deviceId,
              role: "manage",
              plan_id: null,
              response_id: response.id,
              created_at: response.createdAt.toISOString(),
            })
            .execute();
        }
      });
    },

    async findById(id) {
      const row = await selectResponses().where("id", "=", id).executeTakeFirst();
      return row === undefined ? undefined : fromRow(row);
    },

    async findByManageTokenHash(hash) {
      const row = await selectResponses().where("manage_token_hash", "=", hash).executeTakeFirst();
      return row === undefined ? undefined : fromRow(row);
    },

    async findIdByCreationNonce(nonce) {
      const row = await database.db
        .selectFrom("responses")
        .select("id")
        .where("creation_nonce", "=", nonce)
        .executeTakeFirst();
      return row?.id;
    },

    async findForDevice(planId, deviceId) {
      const row = await selectResponses()
        .innerJoin("device_links", "device_links.response_id", "responses.id")
        .where("device_links.device_id", "=", deviceId)
        .where("device_links.role", "=", "manage")
        .where("responses.plan_id", "=", planId)
        .executeTakeFirst();
      return row === undefined ? undefined : fromRow(row);
    },

    async listByPlan(planId) {
      const rows = await selectResponses()
        .where("plan_id", "=", planId)
        .orderBy("created_at")
        .execute();
      return rows.map(fromRow);
    },

    async counts(planId) {
      const rows = await database.db
        .selectFrom("responses")
        .select(["kind", (eb) => eb.fn.countAll<number>().as("n")])
        .where("plan_id", "=", planId)
        .where("kind", "in", ["interested", "joined"])
        .groupBy("kind")
        .execute();
      const count = (kind: string) => rows.find((row) => row.kind === kind)?.n ?? 0;
      return { interested: count("interested"), participants: count("joined") };
    },

    async update(response) {
      await database.db
        .updateTable("responses")
        .set({
          kind: response.kind,
          display_name_enc: cipher.encrypt(response.displayName, DISPLAY_NAME),
          request_note_enc: encryptNote(response.requestNote),
          previous_kind: response.previousKind ?? null,
          updated_at: response.updatedAt.toISOString(),
        })
        .where("id", "=", response.id)
        .execute();
    },

    async delete(id) {
      await database.db.deleteFrom("responses").where("id", "=", id).execute();
      // Manual deletions also leave the WAL (spec 3.10, decision D8).
      checkpoint(database);
    },

    async isBlocked(planId, deviceId) {
      const row = await database.db
        .selectFrom("responses")
        .select("id")
        .where("plan_id", "=", planId)
        .where("device_id", "=", deviceId)
        .where("kind", "in", ["rejected", "removed"])
        .executeTakeFirst();
      return row !== undefined;
    },
  };
}
