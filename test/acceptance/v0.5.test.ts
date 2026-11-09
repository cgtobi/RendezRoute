// v0.5 acceptance criteria (spec 6), one test named after each (spec 2b definition of done). In a
// browser against the built image, e2e/v05.spec.ts covers push permission actually denied by the
// browser, and the calendar feed again.
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../src/adapters/i18n/i18n.ts";
import { runHousekeeping, runRetentionSweep } from "../../src/application/maintenance.ts";
import { createTestApp } from "../support/app.ts";
import { hiddenFields, TestClient } from "../support/client.ts";
import { sampleGpx } from "../support/gpx.ts";
import { createPlanWithRouteViaUi, ownStatus, planForm, respondViaUi } from "../support/plans.ts";

const en = translator("en");
const EXACT = "SENTINEL-gate-9f3a";
const EXACT_LAT = "48.16321";
const ROUTE_LAT = "47.54321";
const RECAP = "SENTINEL-recap-words";
const NOTE = "SENTINEL-request-note";
// sampleInput starts on 7 June 2026 at 07:30 in Berlin; deleted 14 days later.
const AFTER_START = "2026-06-07T06:00:00Z";
const unfold = (text: string) => text.replaceAll("\r\n ", "");

type Test = Awaited<ReturnType<typeof createTestApp>>;

/** A plan with exact start and route; approval mode unless the overrides say otherwise. */
async function planWithRoute(test: Test, overrides: Record<string, string> = {}) {
  const host = new TestClient(test.app);
  const { planId } = await createPlanWithRouteViaUi(
    host,
    { exactDescription: EXACT, exactLat: EXACT_LAT, joinMode: "approval", ...overrides },
    sampleGpx({ lat: Number(ROUTE_LAT) }),
  );
  return { host, planId };
}

/** The CSRF token of a page, failing loudly when there is none. */
async function csrfOf(client: TestClient, path: string): Promise<string> {
  const token = hiddenFields(await (await client.get(path)).text())._csrf;
  if (token === undefined) throw new Error(`no CSRF token on ${path}`);
  return token;
}

/** Posts the first of the host page's accept or reject buttons. */
async function decide(host: TestClient, planId: string, action: "accept" | "reject") {
  const page = await (await host.get(`/p/${planId}/host`)).text();
  const form = new RegExp(
    `<form[^>]*action="(/p/${planId}/host/people/[^"]+/${action})"[\\s\\S]*?</form>`,
  ).exec(page);
  if (form?.[1] === undefined) throw new Error(`no ${action} button`);
  expect((await host.postForm(form[1], hiddenFields(form[0]))).status).toBe(303);
}

async function contribute(client: TestClient, planId: string, body: string) {
  const _csrf = await csrfOf(client, `/p/${planId}`);
  const response = await client.postForm(`/p/${planId}/recap`, { _csrf, body, linkUrl: "" });
  expect(response.status).toBe(303);
}

/** The device's own calendar feed, fetched like a calendar server would: without cookies. */
async function ownFeed(test: Test, client: TestClient): Promise<string> {
  const created = await client.postForm("/calendar", await client.hiddenFields("/calendar"));
  const path = /https:\/\/runs\.example\.org(\/c\/[A-Za-z0-9_-]{43})/.exec(await created.text());
  // Devices whose only plan does not list them (rejected, removed) get no feed: nothing to show.
  return path?.[1] === undefined ? "" : unfold(await (await test.app.request(path[1])).text());
}

/** Every response a person can get about the plan (spec 2b), ZIP exports unpacked. */
async function everything(test: Test, client: TestClient, planId: string): Promise<string> {
  const paths = [
    `/p/${planId}`,
    `/p/${planId}/me`,
    `/p/${planId}/host`,
    `/p/${planId}/calendar.ics`,
    `/p/${planId}/route.gpx`,
    `/p/${planId}/route.geojson`,
    `/p/${planId}/og.png`,
    `/p/${planId}/theme.css`,
    "/my-data",
    "/my-data/export.zip",
    `/p/${planId}/me/export.zip`,
  ];
  const bodies: string[] = [];
  for (const path of paths) {
    const response = await client.get(path);
    if (response.headers.get("content-type") === "application/zip") {
      const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
      bodies.push(...Object.values(files).map((file) => strFromU8(file)));
    } else {
      bodies.push(await response.text());
    }
  }
  bodies.push(await ownFeed(test, client));
  return bodies.join("\n");
}

/**
 * A started approval plan with a participant (who wrote in the recap), a rejected and a pending
 * requester, an interested person and a viewer, each confirmed in their state.
 */
async function startedPlanWithEveryone() {
  const test = await createTestApp();
  const { host, planId } = await planWithRoute(test);
  const person = () => new TestClient(test.app);
  const ben = person();
  await respondViaUi(ben, planId, "Ben", "requested", NOTE);
  await decide(host, planId, "accept");
  const rex = person();
  await respondViaUi(rex, planId, "Rex", "requested", NOTE);
  await decide(host, planId, "reject");
  const pia = person();
  await respondViaUi(pia, planId, "Pia", "requested", NOTE);
  const ida = person();
  await respondViaUi(ida, planId, "Ida", "interested");
  expect(await ownStatus(ben, planId)).toBe(en("status.joined"));
  expect(await ownStatus(rex, planId)).toBe(en("status.rejected"));
  expect(await ownStatus(pia, planId)).toBe(en("status.requested"));
  expect(await ownStatus(ida, planId)).toBe(en("status.interested"));
  test.clock.set(AFTER_START);
  await contribute(ben, planId, RECAP);
  return { ...test, planId, host, ben, rex, pia, ida, viewer: person() };
}

describe("v0.5 acceptance criteria (spec 6)", () => {
  it("Pending and rejected requesters never receive exact location, route or contributions", async () => {
    const setup = await startedPlanWithEveryone();
    // The participant gets all of them through the same requests, so their absence is meaningful.
    const participant = await everything(setup, setup.ben, setup.planId);
    for (const sentinel of [EXACT, EXACT_LAT, ROUTE_LAT, RECAP]) {
      expect(participant).toContain(sentinel);
    }
    for (const client of [setup.pia, setup.rex]) {
      const body = await everything(setup, client, setup.planId);
      for (const sentinel of [EXACT, EXACT_LAT, ROUTE_LAT, RECAP]) {
        expect(body).not.toContain(sentinel);
      }
    }
  });

  it("Interested people and viewers never receive recap contributions", async () => {
    const setup = await startedPlanWithEveryone();
    expect(await everything(setup, setup.ben, setup.planId)).toContain(RECAP);
    for (const client of [setup.ida, setup.viewer]) {
      expect(await everything(setup, client, setup.planId)).not.toContain(RECAP);
    }
  });

  it("Calendar feed reflects changes, cancellations and deletions on the next poll", async () => {
    const test = await createTestApp();
    const { host, planId } = await planWithRoute(test, { joinMode: "open" });
    const ben = new TestClient(test.app);
    await respondViaUi(ben, planId, "Ben", "joined");
    const created = await ben.postForm("/calendar", await ben.hiddenFields("/calendar"));
    const feed = /https:\/\/runs\.example\.org(\/c\/[A-Za-z0-9_-]{43})/.exec(
      await created.text(),
    )?.[1];
    if (feed === undefined) throw new Error("no feed link");
    // Calendar servers poll without the browser's cookies.
    const poll = async () => {
      const response = await test.app.request(feed);
      expect(response.status).toBe(200);
      return unfold(await response.text());
    };
    expect(await poll()).toContain("SUMMARY:Easy Sunday run");

    const _csrf = await csrfOf(host, `/p/${planId}/host`);
    const edited = await host.postForm(`/p/${planId}/host`, {
      ...planForm({ exactDescription: EXACT, exactLat: EXACT_LAT }),
      _csrf,
      title: "Easy Sunday run, later",
      time: "09:00",
    });
    expect(edited.status).toBe(303);
    const changed = await poll();
    expect(changed).toContain("SUMMARY:Easy Sunday run\\, later");
    expect(changed).toContain("DTSTART:20260607T070000Z");

    expect((await host.postForm(`/p/${planId}/host/cancel`, { _csrf })).status).toBe(303);
    expect(await poll()).toContain("STATUS:CANCELLED");

    expect((await host.postForm(`/p/${planId}/host/delete`, { _csrf })).status).toBe(303);
    const afterDeletion = await poll();
    expect(afterDeletion).toContain("BEGIN:VCALENDAR");
    expect(afterDeletion).not.toContain("Easy Sunday run");
  });

  it("The app works fully if push permission is denied", async () => {
    // Without any notification channel (what a denied permission leaves), every flow completes
    // and nothing is queued; e2e/v05.spec.ts denies the permission in a real browser.
    const test = await createTestApp();
    const { host, planId } = await planWithRoute(test);
    const ben = new TestClient(test.app);
    await respondViaUi(ben, planId, "Ben", "requested", NOTE);
    await decide(host, planId, "accept");
    expect(await (await ben.get(`/p/${planId}`)).text()).toContain(EXACT);
    // The switch is rendered hidden, for the browser script to show only where push works.
    expect(await (await ben.get(`/p/${planId}/me`)).text()).toMatch(
      /<div class="push"[^>]* hidden/,
    );
    test.clock.set(AFTER_START);
    await contribute(ben, planId, RECAP);
    expect(await (await ben.get(`/p/${planId}`)).text()).toContain(RECAP);
    const _csrf = await csrfOf(host, `/p/${planId}/host`);
    expect((await host.postForm(`/p/${planId}/host/delete`, { _csrf })).status).toBe(303);
    expect((await ben.get(`/p/${planId}`)).status).toBe(404);
    expect(test.database.sqlite.prepare("select count(*) from job_queue").pluck().get()).toBe(0);
  });

  it("Templates contain no response-related data and expire after 90 days without use", async () => {
    const test = await createTestApp();
    const { host, planId } = await planWithRoute(test, {
      keepAsTemplate: "1",
      templateIncludePrivate: "1",
    });
    const ben = new TestClient(test.app);
    await respondViaUi(ben, planId, "SENTINEL-name-Ben", "requested", NOTE);
    await decide(host, planId, "accept");
    const pia = new TestClient(test.app);
    await respondViaUi(pia, planId, "SENTINEL-name-Pia", "requested", NOTE);
    expect(await ownStatus(pia, planId)).toBe(en("status.requested"));
    test.clock.set(AFTER_START);
    await contribute(ben, planId, RECAP);

    test.clock.set("2026-06-21T05:30:00Z");
    expect(await runRetentionSweep(test.planDeps)).toEqual({ deletedPlans: 1 });
    const rows = test.database.sqlite.prepare("select * from plan_templates").all() as {
      id: string;
    }[];
    expect(rows).toHaveLength(1);
    const templateId = rows[0]?.id ?? "";
    const stored = JSON.stringify([rows, await test.planDeps.templates.findById(templateId)]);
    expect(stored).toContain(EXACT);
    for (const sentinel of ["SENTINEL-name", RECAP, NOTE, planId]) {
      expect(stored).not.toContain(sentinel);
    }

    // Kept on 21 June: due on 19 September, unless used. A repeat on 1 September restarts it.
    const backups = { deleteOlderThan: async () => 0 };
    const housekeeping = () => runHousekeeping({ ...test.planDeps, backups });
    test.clock.set("2026-09-01T10:00:00Z");
    const repeated = await host.postForm(`/templates/${templateId}/repeat`, {
      ...(await host.hiddenFields(`/templates/${templateId}`)),
      date: "2026-09-10",
      time: "07:30",
    });
    expect(repeated.status).toBe(200);
    test.clock.set("2026-09-19T05:31:00Z");
    expect(await housekeeping()).toMatchObject({ deletedTemplates: 0 });
    test.clock.set("2026-11-30T09:59:00Z");
    expect(await housekeeping()).toMatchObject({ deletedTemplates: 0 });
    test.clock.set("2026-11-30T10:00:00Z");
    expect(await housekeeping()).toMatchObject({ deletedTemplates: 1 });
    expect(test.database.sqlite.prepare("select count(*) from plan_templates").pluck().get()).toBe(
      0,
    );
  });
});
