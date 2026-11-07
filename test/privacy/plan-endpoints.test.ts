// Spec 2b privacy tests: sentinel values must be absent from every response an audience
// may not see. Extended by every later step that adds an endpoint or audience.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

/** One plan with a host, a joined, an interested and a removed person. */
async function audiences() {
  const test = await createTestApp();
  const client = () => new TestClient(test.app);
  const host = client();
  const { planId, hostPath } = await createPlanViaUi(host, exactStart);
  const joined = client();
  const { managePath } = await respondViaUi(joined, planId, JOINED_NAME, "joined");
  const interested = client();
  await respondViaUi(interested, planId, INTERESTED_NAME, "interested");
  const removed = client();
  await respondViaUi(removed, planId, REMOVED_NAME, "joined");
  test.database.sqlite
    .prepare(
      "update responses set kind = 'removed', previous_kind = 'joined' where id = (select max(id) from responses)",
    )
    .run();
  return {
    ...test,
    planId,
    hostPath,
    managePath: managePath ?? "",
    host,
    joined,
    interested,
    removed,
    viewer: client(),
    client,
  };
}

async function pages(client: TestClient, planId: string): Promise<string> {
  const paths = [
    `/p/${planId}`,
    `/p/${planId}/me`,
    `/p/${planId}/host`,
    `/p/${planId}/host/delete`,
  ];
  const bodies = await Promise.all(paths.map(async (path) => (await client.get(path)).text()));
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
    const { app, database } = await createTestApp({ databasePath: path });
    const host = new TestClient(app);
    const { planId, hostPath } = await createPlanViaUi(host, exactStart);
    const joined = new TestClient(app);
    const { managePath } = await respondViaUi(joined, planId, JOINED_NAME, "joined");
    const secrets = [
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
  });
});
