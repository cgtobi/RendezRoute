// Private direct Notes to accepted remote participants (decision D43): one row per response. The
// secret GPX link's token is found by a keyed hash and kept encrypted, so an `Update` can send the
// same link again; a replaced token stops being found. Rows go with their response or plan.
import type {
  FieldCipher,
  LookupHasher,
  ParticipantNote,
  ParticipantNoteRepository,
} from "../../../application/ports.ts";
import type { Selectable } from "kysely";
import type { Database } from "./database.ts";
import type { ParticipantNotesTable } from "./schema.ts";

const ROUTE_TOKEN = "participant_notes.route_token" as const;

export function createParticipantNoteRepository(
  database: Database,
  cipher: FieldCipher,
  hasher: LookupHasher,
): ParticipantNoteRepository {
  const { db } = database;
  const tokenHash = (token: string) => hasher.hash(`participant-note-route:${token}`);
  const tokenColumns = (token: string | undefined) => ({
    route_token_hmac: token === undefined ? null : tokenHash(token),
    route_token_enc: token === undefined ? null : cipher.encrypt(token, ROUTE_TOKEN),
  });
  const fromRow = (row: Selectable<ParticipantNotesTable>): ParticipantNote => ({
    responseId: row.response_id,
    planId: row.plan_id,
    noteId: row.note_id,
    localActor: row.local_actor,
    sentAt: new Date(row.sent_at),
    routeToken:
      row.route_token_enc === null ? undefined : cipher.decrypt(row.route_token_enc, ROUTE_TOKEN),
    contentHash: row.content_hash,
  });

  return {
    async create(note, now) {
      const result = await db
        .insertInto("participant_notes")
        .values({
          response_id: note.responseId,
          plan_id: note.planId,
          note_id: note.noteId,
          local_actor: note.localActor,
          ...tokenColumns(note.routeToken),
          content_hash: note.contentHash,
          sent_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        // Two attempts at once: the second finds the Note there and sends nothing.
        .onConflict((conflict) => conflict.column("response_id").doNothing())
        .executeTakeFirst();
      return Number(result.numInsertedOrUpdatedRows) > 0;
    },

    async find(responseId) {
      const row = await db
        .selectFrom("participant_notes")
        .selectAll()
        .where("response_id", "=", responseId)
        .executeTakeFirst();
      return row === undefined ? undefined : fromRow(row);
    },

    async listByPlan(planId) {
      const rows = await db
        .selectFrom("participant_notes")
        .selectAll()
        .where("plan_id", "=", planId)
        .orderBy("sent_at")
        .orderBy("response_id")
        .execute();
      return rows.map(fromRow);
    },

    async listByActor(localActor) {
      const rows = await db
        .selectFrom("participant_notes")
        .selectAll()
        .where("local_actor", "=", localActor)
        .orderBy("sent_at")
        .orderBy("response_id")
        .execute();
      return rows.map(fromRow);
    },

    async update(note, now) {
      await db
        .updateTable("participant_notes")
        .set({
          // The sender may have changed to the instance actor, if the first can no longer sign.
          local_actor: note.localActor,
          ...tokenColumns(note.routeToken),
          content_hash: note.contentHash,
          updated_at: now.toISOString(),
        })
        .where("response_id", "=", note.responseId)
        .execute();
    },

    async delete(responseId) {
      await db.deleteFrom("participant_notes").where("response_id", "=", responseId).execute();
    },

    async findByRouteToken(token) {
      if (token === "") return undefined;
      const row = await db
        .selectFrom("participant_notes")
        .selectAll()
        .where("route_token_hmac", "=", tokenHash(token))
        .executeTakeFirst();
      return row === undefined ? undefined : fromRow(row);
    },

    fingerprint: (content) => hasher.hash(`participant-note:${content}`),
  };
}
