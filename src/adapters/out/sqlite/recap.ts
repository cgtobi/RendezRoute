// Recap contributions (spec 6 feature 5): comment and link encrypted (spec 3.11); deletions are
// physical (spec 3.10).
import { sql } from "kysely";
import type { FieldCipher, RecapRepository } from "../../../application/ports.ts";
import type { RecapContribution } from "../../../domain/recap.ts";
import { checkpoint, type Database } from "./database.ts";
import type { RecapContributionsTable } from "./schema.ts";

const BODY = "recap_contributions.body";
const LINK = "recap_contributions.link_url";

export function createRecapRepository(database: Database, cipher: FieldCipher): RecapRepository {
  const encrypt = (value: string | undefined, field: typeof BODY | typeof LINK) =>
    value === undefined ? null : cipher.encrypt(value, field);
  const decrypt = (value: string | null, field: typeof BODY | typeof LINK) =>
    value === null ? undefined : cipher.decrypt(value, field);
  const fromRow = (row: RecapContributionsTable): RecapContribution => ({
    id: row.id,
    planId: row.plan_id,
    responseId: row.response_id ?? undefined,
    body: decrypt(row.body_enc, BODY),
    linkUrl: decrypt(row.link_url_enc, LINK),
    hiddenByHost: row.hidden_by_poster === 1,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
  const content = (c: RecapContribution) => ({
    body_enc: encrypt(c.body, BODY),
    link_url_enc: encrypt(c.linkUrl, LINK),
    hidden_by_poster: c.hiddenByHost ? 1 : 0,
    updated_at: c.updatedAt.toISOString(),
  });
  const deleted = (result: { numDeletedRows: bigint }) => {
    const count = Number(result.numDeletedRows);
    // Manual deletions also leave the WAL (spec 3.10).
    if (count > 0) checkpoint(database);
    return count;
  };

  return {
    async create(c) {
      await database.db
        .insertInto("recap_contributions")
        .values({
          id: c.id,
          plan_id: c.planId,
          response_id: c.responseId ?? null,
          created_at: c.createdAt.toISOString(),
          ...content(c),
        })
        .execute();
    },

    async createWithinLimit(c, max) {
      const { body_enc, link_url_enc, hidden_by_poster, updated_at } = content(c);
      // One statement: the count and the insert cannot be split by another attempt.
      const result = await sql`
        insert into recap_contributions
          (id, plan_id, response_id, created_at, body_enc, link_url_enc, hidden_by_poster, updated_at)
        select ${c.id}, ${c.planId}, ${c.responseId ?? null}, ${c.createdAt.toISOString()},
          ${body_enc}, ${link_url_enc}, ${hidden_by_poster}, ${updated_at}
        where (
          select count(*) from recap_contributions
          where plan_id = ${c.planId} and response_id is ${c.responseId ?? null}
        ) < ${max}`.execute(database.db);
      return Number(result.numAffectedRows ?? 0) > 0;
    },

    async update(c) {
      await database.db
        .updateTable("recap_contributions")
        .set(content(c))
        .where("id", "=", c.id)
        .execute();
    },

    async findById(id) {
      const row = await database.db
        .selectFrom("recap_contributions")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      return row === undefined ? undefined : fromRow(row);
    },

    async listByPlan(planId) {
      const rows = await database.db
        .selectFrom("recap_contributions")
        .selectAll()
        .where("plan_id", "=", planId)
        .orderBy("created_at")
        .orderBy("id")
        .execute();
      return rows.map(fromRow);
    },

    async countByPlan(planId) {
      const row = await database.db
        .selectFrom("recap_contributions")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("plan_id", "=", planId)
        .executeTakeFirstOrThrow();
      return Number(row.count);
    },

    async countByAuthor(planId, responseId) {
      const row = await database.db
        .selectFrom("recap_contributions")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("plan_id", "=", planId)
        .where("response_id", responseId === undefined ? "is" : "=", responseId ?? null)
        .executeTakeFirstOrThrow();
      return Number(row.count);
    },

    async delete(id) {
      deleted(
        await database.db.deleteFrom("recap_contributions").where("id", "=", id).executeTakeFirst(),
      );
    },

    async deleteForResponse(responseId) {
      deleted(
        await database.db
          .deleteFrom("recap_contributions")
          .where("response_id", "=", responseId)
          .executeTakeFirst(),
      );
    },

    async deleteForPlan(planId) {
      return deleted(
        await database.db
          .deleteFrom("recap_contributions")
          .where("plan_id", "=", planId)
          .executeTakeFirst(),
      );
    },
  };
}
