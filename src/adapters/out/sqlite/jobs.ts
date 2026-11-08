// Job queue in SQLite (spec 4 job_queue): payloads encrypted with the field cipher; plan and
// response jobs cascade with them.
import type { FieldCipher, IdGenerator, JobQueue } from "../../../application/ports.ts";
import type { Database } from "./database.ts";

const PAYLOAD = "job_queue.payload";

export function createJobQueue(
  database: Database,
  cipher: FieldCipher,
  ids: IdGenerator,
): JobQueue {
  const { db } = database;
  return {
    async enqueue(job) {
      const id = ids.rowId();
      await db
        .insertInto("job_queue")
        .values({
          id,
          type: job.type,
          payload_enc: cipher.encrypt(JSON.stringify(job.payload), PAYLOAD),
          plan_id: job.planId ?? null,
          response_id: job.responseId ?? null,
          run_at: job.runAt.toISOString(),
          expires_at: job.expiresAt?.toISOString() ?? null,
          last_error: null,
        })
        .execute();
      return id;
    },

    async due(now, limit) {
      const rows = await db
        .selectFrom("job_queue")
        .select(["id", "type", "payload_enc", "attempts", "expires_at"])
        .where("run_at", "<=", now.toISOString())
        .orderBy("run_at")
        .orderBy("id")
        .limit(limit)
        .execute();
      return rows.map((row) => ({
        id: row.id,
        type: row.type,
        payload: JSON.parse(cipher.decrypt(row.payload_enc, PAYLOAD)) as unknown,
        attempts: row.attempts,
        expiresAt: row.expires_at === null ? undefined : new Date(row.expires_at),
      }));
    },

    async complete(id) {
      await db.deleteFrom("job_queue").where("id", "=", id).execute();
    },

    async retry(id, runAt, error) {
      await db
        .updateTable("job_queue")
        .set((eb) => ({
          run_at: runAt.toISOString(),
          attempts: eb("attempts", "+", 1),
          last_error: error,
        }))
        .where("id", "=", id)
        .execute();
    },

    async deleteExpired(now) {
      const result = await db
        .deleteFrom("job_queue")
        .where("expires_at", "is not", null)
        .where("expires_at", "<=", now.toISOString())
        .executeTakeFirst();
      return Number(result.numDeletedRows);
    },
  };
}
