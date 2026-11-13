// Direct Notes that carry recap contributions to joined remote participants (decisions D44, D45):
// one row per contribution and recipient. Only identifiers, who sent it and a keyed fingerprint of
// what was sent are kept; the contribution's text stays in its encrypted columns. Rows go with
// their contribution, the recipient's response or the plan.
import type { Selectable } from "kysely";
import type {
  ContributionNote,
  ContributionNoteRepository,
  LookupHasher,
} from "../../../application/ports.ts";
import type { Database } from "./database.ts";
import type { ContributionNotesTable } from "./schema.ts";

export function createContributionNoteRepository(
  database: Database,
  hasher: LookupHasher,
): ContributionNoteRepository {
  const { db } = database;
  const fromRow = (row: Selectable<ContributionNotesTable>): ContributionNote => ({
    noteId: row.note_id,
    contributionId: row.contribution_id,
    responseId: row.response_id,
    planId: row.plan_id,
    localActor: row.local_actor,
    sentAt: new Date(row.sent_at),
    contentHash: row.content_hash,
  });
  const listWhere = async (
    column: "contribution_id" | "response_id" | "plan_id" | "local_actor",
    value: string,
  ) =>
    (
      await db
        .selectFrom("contribution_notes")
        .selectAll()
        .where(column, "=", value)
        .orderBy("sent_at")
        .orderBy("note_id")
        .execute()
    ).map(fromRow);

  return {
    async create(note, now) {
      const result = await db
        .insertInto("contribution_notes")
        .values({
          note_id: note.noteId,
          contribution_id: note.contributionId,
          response_id: note.responseId,
          plan_id: note.planId,
          local_actor: note.localActor,
          content_hash: note.contentHash,
          sent_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        // Two attempts at once: the second finds the Note there and sends nothing.
        .onConflict((conflict) => conflict.columns(["contribution_id", "response_id"]).doNothing())
        .executeTakeFirst();
      return Number(result.numInsertedOrUpdatedRows) > 0;
    },

    async find(contributionId, responseId) {
      const row = await db
        .selectFrom("contribution_notes")
        .selectAll()
        .where("contribution_id", "=", contributionId)
        .where("response_id", "=", responseId)
        .executeTakeFirst();
      return row === undefined ? undefined : fromRow(row);
    },

    async findByNoteId(noteId) {
      const row = await db
        .selectFrom("contribution_notes")
        .selectAll()
        .where("note_id", "=", noteId)
        .executeTakeFirst();
      return row === undefined ? undefined : fromRow(row);
    },

    listByContribution: (contributionId) => listWhere("contribution_id", contributionId),
    listByRecipient: (responseId) => listWhere("response_id", responseId),
    listByPlan: (planId) => listWhere("plan_id", planId),
    listByActor: (localActor) => listWhere("local_actor", localActor),

    async update(note, now) {
      await db
        .updateTable("contribution_notes")
        .set({
          // The sender may have changed to the instance actor, if the first can no longer sign.
          local_actor: note.localActor,
          content_hash: note.contentHash,
          updated_at: now.toISOString(),
        })
        .where("note_id", "=", note.noteId)
        .execute();
    },

    async delete(noteId) {
      await db.deleteFrom("contribution_notes").where("note_id", "=", noteId).execute();
    },

    fingerprint: (content) => hasher.hash(`contribution-note:${content}`),
  };
}
