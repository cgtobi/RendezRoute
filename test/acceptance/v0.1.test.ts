// v0.1 acceptance criteria (spec 5), one test named after each (spec 2b definition of done).
// "A plan can be created, shared, joined, cancelled and deleted without any account, with
// default settings and with maps, geocoder and weather disabled" runs in a browser against the
// built image: e2e/core-loop.spec.ts. "A manual checklist confirms previews in WhatsApp, Signal
// and Telegram" is part of the release checklist.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createPreviewRenderer } from "../../src/adapters/out/preview/renderer.ts";
import { checkpoint } from "../../src/adapters/out/sqlite/database.ts";
import { runRetentionSweep } from "../../src/application/maintenance.ts";
import { createTestApp } from "../support/app.ts";
import { TestClient } from "../support/client.ts";
import { sampleGpx } from "../support/gpx.ts";
import { planForm, respondViaUi } from "../support/plans.ts";

const EXACT = {
  exactDescription: "SENTINEL-gate-4b2d",
  exactLat: "48.16321",
  exactLng: "11.60147",
};
/** Coordinates only the uploaded route contains (sampleGpx with this latitude, longitude 10.98765). */
const ROUTE_LAT = "47.54321";
const ROUTE_LNG = "10.98765";
const NAME = "SENTINEL-Ben";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "rendezroute-acceptance-"));
  dirs.push(dir);
  return dir;
}

/** A plan with exact start and route, created through the form like a browser would. */
async function planWithRoute(test: Awaited<ReturnType<typeof createTestApp>>) {
  const host = new TestClient(test.app);
  const hidden = await host.hiddenFields("/new");
  const created = await host.postMultipart(
    "/new",
    { ...hidden, ...planForm(EXACT) },
    { gpx: { name: "run.gpx", content: sampleGpx({ lat: Number(ROUTE_LAT) }) } },
  );
  const html = await created.text();
  const planId = /\/p\/([A-Za-z0-9_-]{22})/.exec(html)?.[1] ?? "";
  const hostPath = /https:\/\/runs\.example\.org(\/a\/[A-Za-z0-9_-]{43})/.exec(html)?.[1] ?? "";
  expect(planId).not.toBe("");
  return { host, planId, hostPath };
}

const metaContent = (html: string, property: string) =>
  new RegExp(`<meta (?:property|name)="${property}" content="([^"]*)"`).exec(html)?.[1];

describe("v0.1 acceptance criteria (spec 5)", () => {
  it("Exact start point and route never appear in responses to non-participants, including OG tags and images", async () => {
    const test = await createTestApp();
    const { host, planId, hostPath } = await planWithRoute(test);
    // Control: the host sees both, so their absence below means something.
    expect(await (await host.get(`/p/${planId}`)).text()).toContain(EXACT.exactDescription);
    expect(await (await host.get(`/p/${planId}/route.geojson`)).text()).toContain(ROUTE_LNG);
    const viewer = new TestClient(test.app);
    const interested = new TestClient(test.app);
    await respondViaUi(interested, planId, "Ida", "interested");
    // A link-preview fetcher that opens the host link and follows to the plan (decision D1).
    const fetcher = new TestClient(test.app);
    await fetcher.get(hostPath);

    const paths = ["", "/og.png", "/route.gpx", "/route.geojson", "/theme.css", "/me", "/host"];
    for (const client of [viewer, interested, fetcher]) {
      for (const path of paths) {
        const body = await (await client.get(`/p/${planId}${path}`)).text();
        for (const secret of [
          EXACT.exactDescription,
          EXACT.exactLat,
          EXACT.exactLng,
          ROUTE_LAT,
          ROUTE_LNG,
        ]) {
          expect({ path, leaks: body.includes(secret) }).toEqual({ path, leaks: false });
        }
      }
    }
    // The card renderer only ever receives the public preview.
    const rendered = JSON.stringify(test.previewRenderer.rendered);
    expect(test.previewRenderer.rendered.length).toBeGreaterThan(0);
    for (const secret of [EXACT.exactDescription, EXACT.exactLat, ROUTE_LAT]) {
      expect(rendered).not.toContain(secret);
    }
  });

  it("OG tags are present and valid", async () => {
    const renderer = createPreviewRenderer({
      instanceName: "RendezRoute",
      attribution: "",
      tiles: undefined,
    });
    const test = await createTestApp({ renderer });
    const host = new TestClient(test.app);
    const hidden = await host.hiddenFields("/new");
    const created = await host.postForm("/new", {
      ...hidden,
      ...planForm({ title: `Anna's "fast" & easy run` }),
    });
    const planId = /\/p\/([A-Za-z0-9_-]{22})/.exec(await created.text())?.[1] ?? "";
    const html = await (await new TestClient(test.app).get(`/p/${planId}`)).text();

    expect(metaContent(html, "og:type")).toBe("website");
    expect(metaContent(html, "og:title")).toBe("Anna&#39;s &quot;fast&quot; &amp; easy run");
    expect(metaContent(html, "og:description")).toContain("Englischer Garten, north end");
    expect(metaContent(html, "og:url")).toBe(`https://runs.example.org/p/${planId}`);
    expect(metaContent(html, "og:image:width")).toBe("1200");
    expect(metaContent(html, "og:image:height")).toBe("630");
    expect(metaContent(html, "twitter:card")).toBe("summary_large_image");
    const image = metaContent(html, "og:image") ?? "";
    expect(image).toMatch(
      new RegExp(`^https://runs\\.example\\.org/p/${planId}/og\\.png\\?v=\\w+$`),
    );

    const response = await test.app.request(new URL(image).pathname + new URL(image).search);
    expect(response.headers.get("content-type")).toBe("image/png");
    const png = Buffer.from(await response.arrayBuffer());
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });

  it("A plan is fully removed within one sweep interval after delete_at, with no leftover row, job or file", async () => {
    const dir = tempDir();
    const path = join(dir, "rendezroute.db");
    const test = await createTestApp({ databasePath: path });
    const { planId } = await planWithRoute(test);
    await respondViaUi(new TestClient(test.app), planId, NAME, "joined");
    await test.app.request(`/p/${planId}/og.png`); // cache a preview image too

    test.clock.set("2026-06-21T05:29:00Z");
    expect(await runRetentionSweep(test.planDeps)).toEqual({ deletedPlans: 0 });
    checkpoint(test.database);
    // Control: before the sweep, the database file does mention the plan.
    expect(readFileSync(path).toString("latin1")).toContain(planId);

    // The sample plan starts 2026-06-07 05:30 UTC and is kept 14 days by default.
    test.clock.set("2026-06-21T05:30:00Z");
    expect(await runRetentionSweep(test.planDeps)).toEqual({ deletedPlans: 1 });
    checkpoint(test.database);

    const tables = test.database.sqlite
      .prepare("select name from sqlite_master where type = 'table'")
      .pluck()
      .all() as string[];
    for (const table of tables) {
      const rows = JSON.stringify(test.database.sqlite.prepare(`select * from "${table}"`).all());
      expect({ table, leftover: rows.includes(planId) }).toEqual({ table, leftover: false });
    }
    // No file in the data directory mentions the plan (pre-migration backups excepted, I12).
    for (const file of readdirSync(dir)) {
      const content = readFileSync(join(dir, file)).toString("latin1");
      for (const trace of [planId, NAME, EXACT.exactDescription]) {
        expect({ file, trace, found: content.includes(trace) }).toEqual({
          file,
          trace,
          found: false,
        });
      }
    }
    expect((await new TestClient(test.app).get(`/p/${planId}`)).status).toBe(404);
    await test.database.close();
  });

  it("Encrypted fields never appear in plaintext in the database file", async () => {
    const dir = tempDir();
    const path = join(dir, "rendezroute.db");
    const test = await createTestApp({ databasePath: path });
    const { planId } = await planWithRoute(test);
    await respondViaUi(new TestClient(test.app), planId, NAME, "joined");

    const raw = () =>
      [path, `${path}-wal`]
        .filter(existsSync)
        .map((file) => readFileSync(file).toString("latin1"))
        .join("");
    for (const content of [raw(), (checkpoint(test.database), raw())]) {
      for (const secret of [EXACT.exactDescription, EXACT.exactLat, ROUTE_LAT, ROUTE_LNG, NAME]) {
        expect(content).not.toContain(secret);
      }
    }
    await test.database.close();
  });
});
