// v0.6 acceptance criteria (spec 6a), one test named after each (spec 2b definition of done).
// "Nobody but the host ever receives ratings or rating notes, …" runs across every audience and
// endpoint in test/privacy/plan-endpoints.test.ts.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { checkpoint } from "../../src/adapters/out/sqlite/database.ts";
import { runRetentionSweep } from "../../src/application/maintenance.ts";
import { createTestApp } from "../support/app.ts";
import { hiddenFields, TestClient } from "../support/client.ts";
import { createPlanViaUi, respondViaUi } from "../support/plans.ts";

// sampleInput starts on 7 June 2026 at 07:30 in Berlin; recap open for a week; deleted on 21 June.
const AFTER_START = "2026-06-07T06:00:00Z";
const CLOSED = "2026-06-14T05:30:00Z";
const SENTINEL = "SENTINEL-rating";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Test = Awaited<ReturnType<typeof createTestApp>>;

const ratingIds = (test: Test) =>
  test.database.sqlite.prepare("select id from plan_ratings").pluck().all() as string[];

/** Rates through the plan page and returns the new rating's ID. */
async function rate(test: Test, client: TestClient, planId: string, note: string) {
  const before = new Set(ratingIds(test));
  const _csrf = hiddenFields(await (await client.get(`/p/${planId}`)).text())._csrf ?? "";
  const response = await client.postForm(`/p/${planId}/rating`, { _csrf, value: "up", note });
  expect(response.status).toBe(303);
  const id = ratingIds(test).find((candidate) => !before.has(candidate));
  if (id === undefined) throw new Error("no rating stored");
  return id;
}

/** No table holds any of these rating IDs any more. */
function expectGone(test: Test, ids: readonly string[]) {
  const tables = test.database.sqlite
    .prepare("select name from sqlite_master where type = 'table'")
    .pluck()
    .all() as string[];
  const rows = tables
    .map((table) => JSON.stringify(test.database.sqlite.prepare(`select * from "${table}"`).all()))
    .join("\n");
  for (const id of ids) {
    expect(id).not.toBe("");
    expect(rows).not.toContain(id);
  }
}

/** A started plan with participants who each rate with a sentinel note; returns their rating IDs. */
async function ratedPlan(test: Test, names: readonly string[], input = {}) {
  test.clock.set("2026-06-01T08:00:00Z");
  const host = new TestClient(test.app);
  const { planId } = await createPlanViaUi(host, input);
  const people = new Map<string, TestClient>();
  for (const name of names) {
    const client = new TestClient(test.app);
    await respondViaUi(client, planId, name, "joined");
    people.set(name, client);
  }
  test.clock.set(AFTER_START);
  const ids = new Map<string, string>();
  for (const [name, client] of people) {
    ids.set(name, await rate(test, client, planId, `${SENTINEL}-${name}`));
  }
  return { host, planId, people, ids };
}

/** Posts a form whose CSRF token comes from `page`. */
async function post(client: TestClient, page: string, action: string) {
  const _csrf = hiddenFields(await (await client.get(page)).text())._csrf ?? "";
  return client.postForm(action, { _csrf });
}

describe("v0.6 acceptance criteria (spec 6a)", () => {
  it("Ratings and notes are deleted with the plan, the response and on own-data deletion, and never reach templates, calendars, feeds or previews", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rendezroute-ratings-"));
    dirs.push(dir);
    const path = join(dir, "data.db");
    const test = await createTestApp({ databasePath: path });
    const kept = await ratedPlan(test, ["Ben", "Lea", "Max", "Tom"], {
      keepAsTemplate: "1",
      templateIncludePrivate: "1",
    });
    const deleted = await ratedPlan(test, ["Ada", "Bo", "Cy"], { title: "Deleted by host" });
    const ben = kept.people.get("Ben") as TestClient;
    const feed = /https:\/\/runs\.example\.org(\/c\/[A-Za-z0-9_-]{43})/.exec(
      await (await ben.postForm("/calendar", await ben.hiddenFields("/calendar"))).text(),
    )?.[1];
    if (feed === undefined) throw new Error("no feed");

    // After the close the host's result is due: still nothing in calendars, feeds or previews.
    test.clock.set(CLOSED);
    expect(await (await kept.host.get(`/p/${kept.planId}/host`)).text()).toContain(
      `${SENTINEL}-Ben`,
    );
    const feedResponse = await test.app.request(feed);
    expect(feedResponse.status).toBe(200);
    const outside = [
      await (await kept.host.get(`/p/${kept.planId}/calendar.ics`)).text(),
      await (await ben.get(`/p/${kept.planId}/calendar.ics`)).text(),
      await feedResponse.text(),
    ];
    for (const calendar of outside) expect(calendar).toContain("BEGIN:VCALENDAR");
    expect((await kept.host.get(`/p/${kept.planId}/og.png`)).status).toBe(200);
    expect(test.previewRenderer.rendered.length).toBeGreaterThan(0);
    outside.push(JSON.stringify(test.previewRenderer.rendered));
    for (const body of outside) expect(body).not.toContain(SENTINEL);

    // Removal deletes that person's rating, and only theirs.
    const tom = kept.ids.get("Tom") ?? "";
    const tomResponse = String(
      test.database.sqlite
        .prepare("select response_id from plan_ratings where id = ?")
        .pluck()
        .get(tom),
    );
    const removed = await post(
      kept.host,
      `/p/${kept.planId}/host`,
      `/p/${kept.planId}/host/people/${tomResponse}/remove`,
    );
    expect(removed.status).toBe(303);
    expectGone(test, [tom]);
    expect(ratingIds(test)).toContain(kept.ids.get("Ben"));

    // Withdrawal deletes the response with its rating.
    const lea = kept.people.get("Lea") as TestClient;
    const withdrawn = await post(lea, `/p/${kept.planId}/me`, `/p/${kept.planId}/me/withdraw`);
    expect(withdrawn.status).toBe(303);
    expectGone(test, [kept.ids.get("Lea") ?? ""]);

    // Own-data deletion deletes the person's rating.
    const max = kept.people.get("Max") as TestClient;
    const ownData = await max.postForm(
      "/my-data/delete",
      hiddenFields(await (await max.get("/my-data/delete")).text()),
    );
    expect(ownData.status).toBe(303);
    expectGone(test, [kept.ids.get("Max") ?? ""]);

    // The host deleting a plan deletes all its ratings.
    const confirm = await (await deleted.host.get(`/p/${deleted.planId}/host/delete`)).text();
    const byHost = await deleted.host.postForm(
      `/p/${deleted.planId}/host/delete`,
      hiddenFields(confirm),
    );
    expect(byHost.status).toBe(303);
    expectGone(test, [...deleted.ids.values()]);

    // Retention deletes the plan with its last rating; the kept template holds none of it.
    test.clock.set("2026-06-21T05:30:00Z");
    expect(await runRetentionSweep(test.planDeps)).toEqual({ deletedPlans: 1 });
    expectGone(test, [kept.ids.get("Ben") ?? ""]);
    expect(ratingIds(test)).toEqual([]);
    const [template] = test.database.sqlite
      .prepare("select id from plan_templates")
      .pluck()
      .all() as string[];
    const copy = JSON.stringify(await test.planDeps.templates.findById(template ?? ""));
    expect(copy).toContain("Easy Sunday run");
    expect(copy).not.toContain(SENTINEL);

    // Nothing in the logs, and no note in the database files in plain text.
    expect(test.logs.join("\n")).not.toContain(SENTINEL);
    checkpoint(test.database);
    for (const file of [path, `${path}-wal`].filter(existsSync)) {
      expect(readFileSync(file).toString("latin1")).not.toContain(SENTINEL);
    }
  });
});
