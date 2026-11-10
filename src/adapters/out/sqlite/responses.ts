// Response persistence (spec 3.5, 4). Display names pass through FieldCipher.
import { type Selectable, sql } from "kysely";
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
    async create({ response, manageTokenHash, creationNonce, deviceId, identityId }) {
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
            identity_id: identityId ?? null,
            language: response.language,
            previous_kind: response.previousKind ?? null,
            creation_nonce: creationNonce,
            created_at: response.createdAt.toISOString(),
            updated_at: response.updatedAt.toISOString(),
          })
          .execute();
        // An account's response reaches its devices through the account (device_access).
        if (deviceId !== undefined && identityId === undefined) {
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

    async setManageTokenHash(responseId, hash) {
      await database.db
        .updateTable("responses")
        .set({ manage_token_hash: hash })
        .where("id", "=", responseId)
        .execute();
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
        .innerJoin("device_access as access", "access.response_id", "responses.id")
        .where("access.device_id", "=", deviceId)
        .where("access.role", "=", "manage")
        // A browser that responded on its own and then logged in to an account that responded
        // elsewhere: its own response first (spec 3.2), then the oldest.
        .orderBy(sql`case access.source when 'link' then 0 else 1 end`)
        .orderBy("responses.created_at")
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
      // The same device, or the account it is logged in to (spec 3.5).
      const row = await database.db
        .selectFrom("responses")
        .select("id")
        .where("plan_id", "=", planId)
        .where("kind", "in", ["rejected", "removed"])
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
        .executeTakeFirst();
      return row !== undefined;
    },
  };
}
