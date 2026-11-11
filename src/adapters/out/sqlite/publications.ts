// Plans in the fediverse (spec 7 ActivityPub; decisions D38, D39): who sent each to which
// audience, and those withdrawn for good. A row goes with its plan.
import type {
  PlanPublication,
  PublicationRepository,
  PublicationState,
} from "../../../application/ports.ts";
import type { Database } from "./database.ts";
import type { PlanPublicationsTable } from "./schema.ts";

type Row = Pick<PlanPublicationsTable, "plan_id" | "local_actor" | "audience">;

/** The publication a row holds; undefined once withdrawn. */
const publicationOf = (row: Row): PlanPublication | undefined =>
  row.local_actor === null || row.audience === null
    ? undefined
    : { planId: row.plan_id, localActor: row.local_actor, audience: row.audience };

export function createPublicationRepository(database: Database): PublicationRepository {
  const { db } = database;
  return {
    async find(planId): Promise<PublicationState> {
      const row = await db
        .selectFrom("plan_publications")
        .select(["plan_id", "local_actor", "audience"])
        .where("plan_id", "=", planId)
        .executeTakeFirst();
      if (row === undefined) return { kind: "none" };
      const publication = publicationOf(row);
      return publication === undefined
        ? { kind: "withdrawn" }
        : { kind: "published", ...publication };
    },

    async findPublished(planIds) {
      if (planIds.length === 0) return [];
      const rows = await db
        .selectFrom("plan_publications")
        .select(["plan_id", "local_actor", "audience"])
        .where("plan_id", "in", planIds)
        .where("withdrawn_at", "is", null)
        .execute();
      return rows.flatMap((row) => publicationOf(row) ?? []);
    },

    async publish(publication, now) {
      await db
        .insertInto("plan_publications")
        .values({
          plan_id: publication.planId,
          local_actor: publication.localActor,
          audience: publication.audience,
          published_at: now.toISOString(),
          withdrawn_at: null,
        })
        .onConflict((conflict) =>
          conflict.column("plan_id").doUpdateSet({
            local_actor: publication.localActor,
            audience: publication.audience,
            withdrawn_at: null,
          }),
        )
        .execute();
    },

    async withdraw(planId, now) {
      await db
        .updateTable("plan_publications")
        .set({ local_actor: null, audience: null, withdrawn_at: now.toISOString() })
        .where("plan_id", "=", planId)
        .execute();
    },

    async withdrawAllBy(localActor, now) {
      await db
        .updateTable("plan_publications")
        .set({ local_actor: null, audience: null, withdrawn_at: now.toISOString() })
        .where("local_actor", "=", localActor)
        .execute();
    },
  };
}
