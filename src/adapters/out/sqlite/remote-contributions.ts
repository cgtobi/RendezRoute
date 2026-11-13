// Which contribution a remote participant's reply Note became (decisions D44, D45), so the
// author's own `Update` and `Delete` of that Note find it. The Note's address is kept only as a
// keyed hash with its own prefix; a mapping goes with its contribution, the author's response or
// the plan.
import type { LookupHasher, RemoteContributionRepository } from "../../../application/ports.ts";
import type { Database } from "./database.ts";

export function createRemoteContributionRepository(
  database: Database,
  hasher: LookupHasher,
): RemoteContributionRepository {
  const { db } = database;
  const noteHash = (remoteNoteId: string) => hasher.hash(`recap-remote-note:${remoteNoteId}`);
  return {
    async create(mapping, now) {
      const result = await db
        .insertInto("remote_contributions")
        .values({
          contribution_id: mapping.contributionId,
          response_id: mapping.responseId,
          plan_id: mapping.planId,
          remote_note_hmac: noteHash(mapping.remoteNoteId),
          created_at: now.toISOString(),
        })
        // The same Note of the same author: the first contribution stands.
        .onConflict((conflict) => conflict.columns(["response_id", "remote_note_hmac"]).doNothing())
        .executeTakeFirst();
      return Number(result.numInsertedOrUpdatedRows) > 0;
    },

    async findContribution(responseId, remoteNoteId) {
      const row = await db
        .selectFrom("remote_contributions")
        .select("contribution_id")
        .where("response_id", "=", responseId)
        .where("remote_note_hmac", "=", noteHash(remoteNoteId))
        .executeTakeFirst();
      return row?.contribution_id;
    },
  };
}
