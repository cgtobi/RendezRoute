// Spec 2b privacy tests: sentinel values must be absent from every response an audience
// may not see. Extended by every later step that adds an endpoint or audience.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { checkpoint } from "../../src/adapters/out/sqlite/database.ts";
import { createTestApp } from "../support/app.ts";
import { hiddenFields as hiddenFieldsOf, TestClient } from "../support/client.ts";
import { sampleGpx } from "../support/gpx.ts";
import { createPlanViaUi, planForm as planFormFields, respondViaUi } from "../support/plans.ts";

const SENTINEL_DESCRIPTION = "SENTINEL-exact-start-7c1e";
const SENTINEL_LAT = "48.16321";
const SENTINEL_LNG = "11.60147";
const exactStart = {
  exactDescription: SENTINEL_DESCRIPTION,
  exactLat: SENTINEL_LAT,
  exactLng: SENTINEL_LNG,
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function expectNoExactStart(body: string) {
  expect(body).not.toContain(SENTINEL_DESCRIPTION);
  expect(body).not.toContain(SENTINEL_LAT);
  expect(body).not.toContain(SENTINEL_LNG);
}

describe("exact start per audience (spec 3.6)", () => {
  it("is absent for viewers on every plan endpoint", async () => {
    const { app } = await createTestApp();
    const host = new TestClient(app);
    const { planId, hostPath } = await createPlanViaUi(host, exactStart);
    const viewer = new TestClient(app);
    for (const path of [`/p/${planId}`, hostPath, "/a/unknown-token-unknown-token-unknown-tok"]) {
      expectNoExactStart(await (await viewer.get(path)).text());
    }
  });

  it("is absent for a link-preview fetcher that opens the host link and follows to the plan (decision D1)", async () => {
    const { app } = await createTestApp();
    const { planId, hostPath } = await createPlanViaUi(new TestClient(app), exactStart);
    const fetcher = new TestClient(app);
    expectNoExactStart(await (await fetcher.get(hostPath)).text());
    expectNoExactStart(await (await fetcher.get(`/p/${planId}`)).text());
  });

  it("is present for the host", async () => {
    const { app } = await createTestApp();
    const host = new TestClient(app);
    const { planId } = await createPlanViaUi(host, exactStart);
    expect(await (await host.get(`/p/${planId}`)).text()).toContain(SENTINEL_DESCRIPTION);
  });
});

const JOINED_NAME = "SENTINEL-joined-name";
const INTERESTED_NAME = "SENTINEL-interested-name";
const REMOVED_NAME = "SENTINEL-removed-name";
const PENDING_NAME = "SENTINEL-pending-name";
const REJECTED_NAME = "SENTINEL-rejected-name";
const ALL_NAMES = [JOINED_NAME, INTERESTED_NAME, REMOVED_NAME, PENDING_NAME, REJECTED_NAME];

/** One plan with a host and a joined, interested, removed, pending and rejected person. */
async function audiences(env: Record<string, string> = {}) {
  const test = await createTestApp({ env });
  const client = () => new TestClient(test.app);
  const host = client();
  const { planId, hostPath } = await createPlanViaUi(host, exactStart);
  const joined = client();
  const { managePath } = await respondViaUi(joined, planId, JOINED_NAME, "joined");
  const interested = client();
  await respondViaUi(interested, planId, INTERESTED_NAME, "interested");
  const removed = client();
  await respondViaUi(removed, planId, REMOVED_NAME, "joined");
  const setLatest = (kind: string) =>
    test.database.sqlite
      .prepare(
        `update responses set kind = '${kind}', previous_kind = 'joined' where id = (select max(id) from responses)`,
      )
      .run();
  setLatest("removed");
  // Pending and rejected requests, as approval mode would leave them (spec 3.4).
  const pending = client();
  await respondViaUi(pending, planId, PENDING_NAME, "joined");
  setLatest("requested");
  const rejected = client();
  await respondViaUi(rejected, planId, REJECTED_NAME, "joined");
  setLatest("rejected");
  return {
    ...test,
    planId,
    hostPath,
    managePath: managePath ?? "",
    host,
    joined,
    interested,
    removed,
    pending,
    rejected,
    viewer: client(),
    client,
  };
}

/** A response's body; ZIP exports unpacked, so sentinels are searched in every file (spec 3.7). */
async function bodyOf(response: Response): Promise<string> {
  if (response.headers.get("content-type") !== "application/zip") return response.text();
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  return Object.entries(files)
    .map(([name, content]) => `${name}\n${strFromU8(content)}`)
    .join("\n");
}

async function pages(client: TestClient, planId: string): Promise<string> {
  const paths = [
    `/p/${planId}`,
    `/p/${planId}/me`,
    `/p/${planId}/host`,
    `/p/${planId}/host/delete`,
    `/p/${planId}/calendar.ics`,
    "/my-data",
    "/my-data/export.zip",
    `/p/${planId}/me/export.zip`,
    `/p/${planId}/host/export.zip`,
  ];
  const bodies = await Promise.all(paths.map(async (path) => bodyOf(await client.get(path))));
  return bodies.join("\n");
}

describe("names and exact start per audience (spec 3.6)", () => {
  it("viewers see neither names nor the exact start", async () => {
    const { viewer, planId } = await audiences();
    const body = await pages(viewer, planId);
    expectNoExactStart(body);
    for (const name of [JOINED_NAME, INTERESTED_NAME, REMOVED_NAME])
      expect(body).not.toContain(name);
  });

  it("interested people see only their own name, not others or the exact start", async () => {
    const { interested, planId } = await audiences();
    const body = await pages(interested, planId);
    expectNoExactStart(body);
    expect(body).not.toContain(JOINED_NAME);
    expect(body).not.toContain(REMOVED_NAME);
  });

  it("pending and rejected requesters see no other names and no exact start", async () => {
    const { pending, rejected, planId } = await audiences();
    for (const [client, own] of [
      [pending, PENDING_NAME],
      [rejected, REJECTED_NAME],
    ] as const) {
      const body = await pages(client, planId);
      expectNoExactStart(body);
      const others = ALL_NAMES.filter((name) => name !== own);
      for (const name of others) expect(body).not.toContain(name);
    }
  });

  it("removed people see what rejected people see: no names, no exact start", async () => {
    const { removed, planId } = await audiences();
    const body = await pages(removed, planId);
    expectNoExactStart(body);
    expect(body).not.toContain(JOINED_NAME);
    expect(body).not.toContain(INTERESTED_NAME);
  });

  it("participants see the exact start and participant names, not interested or removed names", async () => {
    const { joined, planId } = await audiences();
    const body = await pages(joined, planId);
    expect(body).toContain(SENTINEL_DESCRIPTION);
    expect(body).toContain(JOINED_NAME);
    expect(body).not.toContain(INTERESTED_NAME);
    expect(body).not.toContain(REMOVED_NAME);
  });

  it("the host sees participants and interested people; removed people only on the host page (decision D8)", async () => {
    const { host, planId } = await audiences();
    const body = await pages(host, planId);
    expect(body).toContain(SENTINEL_DESCRIPTION);
    expect(body).toContain(JOINED_NAME);
    expect(body).toContain(INTERESTED_NAME);
    expect(await (await host.get(`/p/${planId}`)).text()).not.toContain(REMOVED_NAME);
    expect(await (await host.get(`/p/${planId}/host`)).text()).toContain(REMOVED_NAME);
  });

  it("a preview fetcher opening a manage link learns nothing private (decision D1)", async () => {
    const { client, planId, managePath } = await audiences();
    const fetcher = client();
    const confirm = await (await fetcher.get(managePath)).text();
    const body = confirm + (await pages(fetcher, planId));
    expectNoExactStart(body);
    for (const name of [JOINED_NAME, INTERESTED_NAME, REMOVED_NAME])
      expect(body).not.toContain(name);
  });
});

/** Creates a calendar feed for the client and returns its path. */
async function feedPath(client: TestClient): Promise<string> {
  const hidden = await client.hiddenFields("/calendar");
  const html = await (await client.postForm("/calendar", hidden)).text();
  return /https:\/\/runs\.example\.org(\/c\/[A-Za-z0-9_-]{43})/.exec(html)?.[1] ?? "/c/missing";
}

/** Fetches feeds like a calendar server, checking each is a real calendar so absence means something. */
async function realFeeds(client: TestClient, paths: readonly string[]): Promise<string[]> {
  const bodies: string[] = [];
  for (const path of paths) {
    const response = await client.get(path);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    bodies.push(body);
  }
  return bodies;
}

describe("calendar feeds (spec 6 feature 2: public fields only)", () => {
  it("never contain the exact start or anyone's name, for any audience", async () => {
    const { host, joined, interested, pending, viewer, planId } = await audiences();
    for (const client of [host, joined, interested, pending]) {
      const feed = await (await viewer.get(await feedPath(client))).text();
      expect(feed).toContain(planId);
      expectNoExactStart(feed);
      for (const name of [...ALL_NAMES, "Anna"]) expect(feed).not.toContain(name);
    }
  });

  it("leave out plans where the browser was rejected or removed", async () => {
    const { removed, rejected, planId, app } = await audiences();
    for (const client of [removed, rejected]) {
      // Nothing left to list: no feed link (spec 3.10).
      expect(await feedPath(client)).toBe("/c/missing");
      // A feed made for another plan still leaves this one out.
      await createPlanViaUi(client);
      const feed = await (await new TestClient(app).get(await feedPath(client))).text();
      expect(feed).not.toContain(planId);
    }
  });
});

const RECAP_BODY = "SENTINEL-recap-body";
const RECAP_LINK = "https://www.strava.com/activities/SENTINEL-recap-link";
const AFTER_START = "2026-06-07T06:00:00Z";

/** Adds a recap contribution through the plan page form. */
async function contribute(client: TestClient, planId: string, body: string, linkUrl = "") {
  const hidden = hiddenFieldsOf(await (await client.get(`/p/${planId}`)).text());
  const response = await client.postForm(`/p/${planId}/recap`, {
    _csrf: hidden._csrf ?? "",
    body,
    linkUrl,
  });
  expect(response.status).toBe(303);
}

describe("recap contributions (spec 3.6, acceptance criterion v0.5)", () => {
  it("never reach viewers, interested, pending, rejected or removed people", async () => {
    const setup = await audiences();
    setup.clock.set(AFTER_START);
    await contribute(setup.joined, setup.planId, RECAP_BODY, RECAP_LINK);
    await contribute(setup.host, setup.planId, "SENTINEL-host-recap");
    for (const client of [setup.joined, setup.host]) {
      const body = await pages(client, setup.planId);
      expect(body).toContain(RECAP_BODY);
      expect(body).toContain(RECAP_LINK);
    }
    for (const client of [
      setup.viewer,
      setup.interested,
      setup.pending,
      setup.rejected,
      setup.removed,
    ]) {
      const body = await pages(client, setup.planId);
      expect(body).not.toContain("SENTINEL-recap");
      expect(body).not.toContain("SENTINEL-host-recap");
    }
  });

  it("are exported only to their own author (user decision 2026-11-09)", async () => {
    const setup = await audiences();
    setup.clock.set(AFTER_START);
    await contribute(setup.joined, setup.planId, RECAP_BODY, RECAP_LINK);
    await contribute(setup.host, setup.planId, "SENTINEL-host-recap");
    const joinedExport = await bodyOf(await setup.joined.get("/my-data/export.zip"));
    expect(joinedExport).toContain(RECAP_BODY);
    expect(joinedExport).not.toContain("SENTINEL-host-recap");
    const hostExport = await bodyOf(await setup.host.get("/my-data/export.zip"));
    expect(hostExport).toContain("SENTINEL-host-recap");
    expect(hostExport).not.toContain(RECAP_BODY);
  });

  it("are absent from calendar files, feeds, previews and logs", async () => {
    const setup = await audiences();
    const feeds = [await feedPath(setup.host), await feedPath(setup.joined)];
    setup.clock.set(AFTER_START);
    await contribute(setup.joined, setup.planId, RECAP_BODY, RECAP_LINK);
    const bodies = await Promise.all(
      [`/p/${setup.planId}/calendar.ics`, `/p/${setup.planId}/og.png`].map(async (path) =>
        (await setup.joined.get(path)).text(),
      ),
    );
    const feedBodies = await realFeeds(setup.viewer, feeds);
    for (const body of [...bodies, ...feedBodies, setup.logs.join("\n")]) {
      expect(body).not.toContain("SENTINEL-recap");
    }
  });
});

const RATING_NOTE = "SENTINEL-rating-note";
const AFTER_CLOSE = "2026-06-14T05:30:00Z";

describe("ratings (spec 6a, acceptance criterion v0.6)", () => {
  /** The audiences, plus two more participants so the plan reaches 3; the first one rates. */
  async function rated() {
    const setup = await audiences();
    const lea = setup.client();
    await respondViaUi(lea, setup.planId, "Lea", "joined");
    await respondViaUi(setup.client(), setup.planId, "Max", "joined");
    setup.clock.set(AFTER_START);
    const csrf = hiddenFieldsOf(await (await setup.joined.get(`/p/${setup.planId}`)).text())._csrf;
    const saved = await setup.joined.postForm(`/p/${setup.planId}/rating`, {
      _csrf: csrf ?? "",
      value: "down",
      note: RATING_NOTE,
    });
    expect(saved.status).toBe(303);
    return { ...setup, lea };
  }

  it("Nobody but the host ever receives ratings or rating notes, and the host only after the recap closed for plans with at least 3 participants", async () => {
    const setup = await rated();
    // Everyone but the author and the host, including another participant.
    const others = [
      setup.lea,
      setup.viewer,
      setup.interested,
      setup.pending,
      setup.rejected,
      setup.removed,
    ];
    // While the recap is open: nobody but the author, not even the host.
    expect(await pages(setup.joined, setup.planId)).toContain(RATING_NOTE);
    for (const client of [setup.host, ...others]) {
      expect(await pages(client, setup.planId)).not.toContain(RATING_NOTE);
    }
    setup.clock.set(AFTER_CLOSE);
    expect(await pages(setup.host, setup.planId)).toContain(RATING_NOTE);
    for (const client of others) {
      expect(await pages(client, setup.planId)).not.toContain(RATING_NOTE);
    }
  });

  it("are absent from calendar files, feeds, previews and logs", async () => {
    const setup = await rated();
    setup.clock.set(AFTER_CLOSE);
    const feeds = [await feedPath(setup.host), await feedPath(setup.joined)];
    const bodies = await Promise.all(
      [`/p/${setup.planId}/calendar.ics`, `/p/${setup.planId}/og.png`].map(async (path) =>
        (await setup.host.get(path)).text(),
      ),
    );
    const feedBodies = await realFeeds(setup.viewer, feeds);
    for (const body of [...bodies, ...feedBodies, setup.logs.join("\n")]) {
      expect(body).not.toContain(RATING_NOTE);
    }
  });

  it("are not shown to the host either for plans with fewer than 3 participants", async () => {
    const setup = await audiences();
    setup.clock.set(AFTER_START);
    const csrf = hiddenFieldsOf(await (await setup.joined.get(`/p/${setup.planId}`)).text())._csrf;
    await setup.joined.postForm(`/p/${setup.planId}/rating`, {
      _csrf: csrf ?? "",
      value: "down",
      note: RATING_NOTE,
    });
    expect(await pages(setup.joined, setup.planId)).toContain(RATING_NOTE);
    setup.clock.set(AFTER_CLOSE);
    expect(await pages(setup.host, setup.planId)).not.toContain(RATING_NOTE);
  });
});

describe("reports (spec 7 Moderation, 3.6 Instance admin column)", () => {
  const ADMIN_TOKEN = "admin-token-for-tests-0123456789abcdef";
  const DETAILS = "SENTINEL-report-details";
  const ATTACHED = "SENTINEL-attached-post";
  const NOT_ATTACHED = "SENTINEL-not-attached-post";

  it("Nobody but the instance admin sees reports, and the admin page shows only public plan fields and the content a reporter attached", async () => {
    const setup = await audiences({ ADMIN_TOKEN });
    setup.clock.set(AFTER_START);
    await contribute(setup.joined, setup.planId, ATTACHED, RECAP_LINK);
    await contribute(setup.host, setup.planId, NOT_ATTACHED);
    const form = await (await setup.joined.get(`/p/${setup.planId}/report`)).text();
    const attachId = new RegExp(`name="attach" value="([^"]+)"[^>]*>${ATTACHED}`).exec(form)?.[1];
    expect(attachId).toBeDefined();
    const body = new URLSearchParams({
      ...hiddenFieldsOf(form),
      reason: "unsafe",
      details: DETAILS,
      attach: attachId ?? "",
    });
    expect((await setup.joined.postForm(`/p/${setup.planId}/report`, body)).status).toBe(303);

    // Every audience, the reporter included, on every plan page, export and calendar.
    for (const client of [
      setup.host,
      setup.joined,
      setup.interested,
      setup.removed,
      setup.pending,
      setup.rejected,
      setup.viewer,
    ]) {
      expect(await pages(client, setup.planId)).not.toContain(DETAILS);
    }
    expect(setup.logs.join("\n")).not.toContain("SENTINEL");

    // The admin: the report and the attached post, but no names, exact start or other posts.
    const admin = setup.client();
    const login = hiddenFieldsOf(await (await admin.get("/admin/login")).text());
    await admin.postForm("/admin/login", { ...login, token: ADMIN_TOKEN });
    const home = await (await admin.get("/admin/")).text();
    const plan = await (await admin.get(`/admin/plans/${setup.planId}`)).text();
    expect(plan).toContain(DETAILS);
    expect(plan).toContain(ATTACHED);
    expect(plan).toContain(RECAP_LINK);
    expect(plan).toContain("Easy Sunday run");
    for (const page of [home, plan]) {
      expect(page).not.toContain(NOT_ATTACHED);
      expectNoExactStart(page);
      for (const name of ALL_NAMES) expect(page).not.toContain(name);
    }
    expect(home).not.toContain(DETAILS);
  });
});

describe("host link (spec 3.2: shown once on creation)", () => {
  it("appears on no page after the links page, not even for the host", async () => {
    const { app } = await createTestApp();
    const host = new TestClient(app);
    const { planId, hostPath } = await createPlanViaUi(host, exactStart);
    const token = hostPath.slice("/a/".length);
    for (const path of [`/p/${planId}`, "/new", "/"]) {
      expect(await (await host.get(path)).text()).not.toContain(token);
    }
  });
});

describe("data at rest (spec 2b)", () => {
  it("keeps encrypted fields and tokens out of the database and WAL files in plaintext", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rendezroute-privacy-"));
    dirs.push(dir);
    const path = join(dir, "rendezroute.db");
    const { app, database, clock } = await createTestApp({
      databasePath: path,
      env: { ADMIN_TOKEN: "admin-token-for-tests-0123456789abcdef" },
    });
    const host = new TestClient(app);
    const { planId, hostPath } = await createPlanViaUi(host, exactStart);
    const joined = new TestClient(app);
    const { managePath } = await respondViaUi(joined, planId, JOINED_NAME, "joined");
    const feed = await feedPath(host);
    clock.set(AFTER_START);
    await contribute(joined, planId, RECAP_BODY, RECAP_LINK);
    const reportForm = await (await joined.get(`/p/${planId}/report`)).text();
    const reported = await joined.postForm(
      `/p/${planId}/report`,
      new URLSearchParams({
        ...hiddenFieldsOf(reportForm),
        reason: "other",
        details: "SENTINEL-report-at-rest",
        attach: /name="attach" value="([^"]+)"/.exec(reportForm)?.[1] ?? "missing",
      }),
    );
    expect(reported.status).toBe(303);
    expect(database.sqlite.prepare("select count(*) from reports").pluck().get()).toBe(1);
    const secrets = [
      "SENTINEL-report-at-rest",
      RECAP_BODY,
      RECAP_LINK,
      feed.slice("/c/".length),
      SENTINEL_DESCRIPTION,
      SENTINEL_LAT,
      JOINED_NAME,
      hostPath.slice("/a/".length),
      (managePath ?? "/m/missing").slice("/m/".length),
      host.cookies.get("__Host-rr-device") ?? "missing",
      joined.cookies.get("__Host-rr-device") ?? "missing",
    ];
    // Every secret was actually captured (no fallback placeholders).
    for (const secret of secrets) expect(secret).not.toContain("missing");

    const raw = () =>
      [path, `${path}-wal`]
        .filter(existsSync)
        .map((file) => readFileSync(file).toString("latin1"))
        .join("");
    for (const content of [raw(), (checkpoint(database), raw())]) {
      for (const secret of secrets) expect(content).not.toContain(secret);
    }
    await database.close();
  });
});

describe("logs (spec 2b: never tokens, names or exact coordinates)", () => {
  it("contain no tokens, names or exact start through a full create-view-link flow", async () => {
    const { app, logs } = await createTestApp();
    const host = new TestClient(app);
    const { planId, hostPath } = await createPlanViaUi(host, {
      ...exactStart,
      posterName: "SENTINEL-name",
    });
    const other = new TestClient(app);
    await other.postForm("/a", await other.hiddenFields(hostPath));
    await other.get(`/p/${planId}`);

    const output = logs.join("\n");
    expect(logs.length).toBeGreaterThan(0);
    expect(output).not.toContain(hostPath.slice(3));
    expect(output).not.toContain("SENTINEL");
    expect(output).not.toContain(SENTINEL_LAT);
    expect(output).not.toContain(host.cookies.get("__Host-rr-device") ?? "never");
  });
});

describe("plan deletion (spec 2b: no row, job or file references the plan)", () => {
  it("leaves no trace of the plan, its responses or names in any table or file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rendezroute-delete-"));
    dirs.push(dir);
    const path = join(dir, "rendezroute.db");
    const { app, database } = await createTestApp({ databasePath: path });
    const host = new TestClient(app);
    const { planId } = await createPlanViaUi(host, exactStart);
    await respondViaUi(new TestClient(app), planId, JOINED_NAME, "joined");

    const confirm = await (await host.get(`/p/${planId}/host/delete`)).text();
    expect((await host.postForm(`/p/${planId}/host/delete`, hiddenFieldsOf(confirm))).status).toBe(
      303,
    );

    const tables = database.sqlite
      .prepare("select name from sqlite_master where type = 'table'")
      .pluck()
      .all() as string[];
    for (const table of tables) {
      const rows = JSON.stringify(database.sqlite.prepare(`select * from "${table}"`).all());
      // The table name shows up in the failure message.
      expect({ table, referencesPlan: rows.includes(planId) }).toEqual({
        table,
        referencesPlan: false,
      });
    }
    const files = [path, `${path}-wal`]
      .filter(existsSync)
      .map((file) => readFileSync(file).toString("latin1"))
      .join("");
    for (const secret of [planId, JOINED_NAME, SENTINEL_DESCRIPTION])
      expect(files).not.toContain(secret);
    await database.close();
  });
});

describe("route geometry per audience (spec 3.6, decision D10)", () => {
  it("never reaches viewers, interested people or preview fetchers", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const hidden = await host.hiddenFields("/new");
    const created = await host.postMultipart(
      "/new",
      {
        ...hidden,
        ...planFormFields({ exactLat: "", exactLng: "", exactDescription: SENTINEL_DESCRIPTION }),
      },
      { gpx: { name: "run.gpx", content: sampleGpx({ lat: 47.54321 }) } },
    );
    const planId = /\/p\/([A-Za-z0-9_-]{22})/.exec(await created.text())?.[1] ?? "";
    const interested = new TestClient(test.app);
    await respondViaUi(interested, planId, INTERESTED_NAME, "interested");

    for (const client of [new TestClient(test.app), interested]) {
      for (const path of [
        `/p/${planId}`,
        `/p/${planId}/me`,
        `/p/${planId}/route.gpx`,
        `/p/${planId}/host`,
      ]) {
        const body = await (await client.get(path)).text();
        expect(body).not.toContain("47.54321");
        expect(body).not.toContain("10.98765");
      }
    }
    // Calendars never carry the route (spec 6 feature 2). The host's download has the exact
    // start, which here is the route's first point; the rest of the route is in no calendar.
    const download = `/p/${planId}/calendar.ics`;
    const hostDownload = await (await host.get(download)).text();
    expect(hostDownload).toContain("GEO:47.54321;10.98765");
    expect(hostDownload).not.toContain("47.54421");
    const feeds = [await feedPath(host), await feedPath(interested)];
    for (const body of [
      await (await interested.get(download)).text(),
      ...(await Promise.all(feeds.map(async (path) => (await host.get(path)).text()))),
    ]) {
      expect(body).toContain(planId);
      expect(body).not.toContain("47.54321");
      expect(body).not.toContain("47.54421");
    }
  });
});
