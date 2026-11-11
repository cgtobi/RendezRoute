// Plans in the fediverse in SQLite (spec 7 ActivityPub; decisions D38, D39): who sent a plan to
// whom, withdrawn for good, and gone with the plan.
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { type Database, openDatabase } from "../../../../src/adapters/out/sqlite/database.ts";
import { createPublicationRepository } from "../../../../src/adapters/out/sqlite/publications.ts";
import { sql } from "kysely";
import { fixtureNow } from "../../../fixtures/plans.ts";

let database: Database;
const t = fixtureNow.toISOString();

beforeEach(async () => {
  database = await openDatabase(":memory:");
  for (const id of ["plan-1", "plan-2", "plan-3"]) {
    await sql`insert into plans (id, poster_name, poster_language, activity_type, title, starts_at, timezone, area_label,
      drop_policy, recap_window, retention_days, delete_at, host_token_hash, created_at, updated_at)
      values (${id}, 'Anna', 'en', 'run', 'Run', ${t}, 'UTC', 'Park', 'no_drop', '1w', 14, ${t}, ${`hash-${id}`}, ${t}, ${t})`.execute(
      database.db,
    );
  }
});
afterEach(async () => {
  await database.close();
});

describe("plan publications in SQLite (decisions D38, D39)", () => {
  it("records who sent a plan to whom, and a change of audience", async () => {
    const publications = createPublicationRepository(database);
    expect(await publications.find("plan-1")).toEqual({ kind: "none" });
    await publications.publish(
      { planId: "plan-1", localActor: "actor-1", audience: "followers" },
      fixtureNow,
    );
    await publications.publish(
      { planId: "plan-1", localActor: "actor-1", audience: "public" },
      fixtureNow,
    );
    expect(await publications.find("plan-1")).toEqual({
      kind: "published",
      planId: "plan-1",
      localActor: "actor-1",
      audience: "public",
    });
  });

  it("withdraws a plan for good, and every plan of a retired actor", async () => {
    const publications = createPublicationRepository(database);
    for (const planId of ["plan-1", "plan-2"]) {
      await publications.publish({ planId, localActor: "actor-1", audience: "public" }, fixtureNow);
    }
    // Only a plan that was sent can be withdrawn.
    await publications.withdraw("plan-3", fixtureNow);
    expect(await publications.find("plan-3")).toEqual({ kind: "none" });
    expect((await publications.findPublished(["plan-1", "plan-2", "plan-3"])).length).toBe(2);
    await publications.withdrawAllBy("actor-1", fixtureNow);
    expect(await publications.findPublished(["plan-1", "plan-2", "plan-3"])).toEqual([]);
    expect(await publications.find("plan-1")).toEqual({ kind: "withdrawn" });
    // Published again (never done: D39), the row stays consistent.
    await publications.publish(
      { planId: "plan-1", localActor: "actor-2", audience: "followers" },
      fixtureNow,
    );
    expect(await publications.find("plan-1")).toMatchObject({ kind: "published" });
  });

  it("goes with its plan", async () => {
    const publications = createPublicationRepository(database);
    await publications.publish(
      { planId: "plan-1", localActor: "actor-1", audience: "public" },
      fixtureNow,
    );
    database.sqlite.prepare("delete from plans where id = 'plan-1'").run();
    expect(database.sqlite.prepare("select * from plan_publications").all()).toEqual([]);
  });
});
