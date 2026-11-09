// Plan ratings in SQLite (spec 6a, decision D20): the note passes through FieldCipher.
import type { Selectable } from "kysely";
import type { FieldCipher, RatingRepository } from "../../../application/ports.ts";
import type { PlanRating } from "../../../domain/rating.ts";
import { checkpoint, type Database } from "./database.ts";
import type { PlanRatingsTable } from "./schema.ts";
import { iso } from "./shared-fields.ts";

const NOTE = "plan_ratings.note" as const;

export function createRatingRepository(database: Database, cipher: FieldCipher): RatingRepository {
  const { db } = database;
  const fromRow = (row: Selectable<PlanRatingsTable>): PlanRating => ({
    id: row.id,
    planId: row.plan_id,
    responseId: row.response_id,
    value: row.value,
    note: row.note_enc === null ? undefined : cipher.decrypt(row.note_enc, NOTE),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
  return {
    async findByResponse(responseId) {
      const row = await db
        .selectFrom("plan_ratings")
        .selectAll()
        .where("response_id", "=", responseId)
        .executeTakeFirst();
      return row === undefined ? undefined : fromRow(row);
    },

    async listByPlan(planId) {
      const rows = await db
        .selectFrom("plan_ratings")
        .selectAll()
        .where("plan_id", "=", planId)
        .orderBy("created_at")
        .orderBy("id")
        .execute();
      return rows.map(fromRow);
    },

    async save(rating) {
      const before = await db
        .selectFrom("plan_ratings")
        .select("note_enc")
        .where("response_id", "=", rating.responseId)
        .executeTakeFirst();
      const note_enc = rating.note === undefined ? null : cipher.encrypt(rating.note, NOTE);
      const updated_at = iso(rating.updatedAt);
      await db
        .insertInto("plan_ratings")
        .values({
          id: rating.id,
          plan_id: rating.planId,
          response_id: rating.responseId,
          value: rating.value,
          note_enc,
          created_at: iso(rating.createdAt),
          updated_at,
        })
        .onConflict((conflict) =>
          conflict.column("response_id").doUpdateSet({ value: rating.value, note_enc, updated_at }),
        )
        .execute();
      // A replaced note also leaves the WAL (spec 3.10).
      if (before !== undefined && before.note_enc !== null) checkpoint(database);
    },

    async deleteForResponse(responseId) {
      const result = await db
        .deleteFrom("plan_ratings")
        .where("response_id", "=", responseId)
        .executeTakeFirst();
      if (Number(result.numDeletedRows) > 0) checkpoint(database);
    },
  };
}
