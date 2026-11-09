// Used one-time form values in SQLite (decision I44).
import type { FormNonceRepository } from "../../../application/ports.ts";
import type { Database } from "./database.ts";

export function createFormNonceRepository(database: Database): FormNonceRepository {
  const { db } = database;
  return {
    async claim(nonce, now) {
      const result = await db
        .insertInto("used_form_nonces")
        .values({ nonce, used_at: now.toISOString() })
        .onConflict((conflict) => conflict.doNothing())
        .executeTakeFirst();
      return Number(result.numInsertedOrUpdatedRows) === 1;
    },

    async deleteUsedBefore(cutoff) {
      const result = await db
        .deleteFrom("used_form_nonces")
        .where("used_at", "<", cutoff.toISOString())
        .executeTakeFirst();
      return Number(result.numDeletedRows);
    },
  };
}
