// Nearby through the pages (spec 7 Visibility and Nearby plans; decisions D35, I59): the search
// form, public plans only with public fields, the viewer's place neither stored nor logged,
// rate limited, and nothing when it is turned off.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { createTestApp } from "../../support/app.ts";
import { TestClient } from "../../support/client.ts";
import { escaped } from "../../support/html.ts";
import { createPlanViaUi, planForm, respondViaUi } from "../../support/plans.ts";
import { hasStandalone } from "../../support/raw-scan.ts";

const en = translator("en");
const PUBLIC = { PUBLIC_REQUIRES_LOGIN: "false" };
// The sample plan's public point is 48.16, 11.6 (from its exact start).
const NEAR = "lat=48.16&lng=11.6";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function setup(env: Record<string, string> = PUBLIC, databasePath?: string) {
  const test = await createTestApp({
    env,
    ...(databasePath === undefined ? {} : { databasePath }),
  });
  const client = () => new TestClient(test.app);
  return { ...test, client };
}

describe("the Nearby page (spec 7 Visibility and Nearby plans)", () => {
  it("lists public plans near the chosen place, with public fields only", async () => {
    const { client, app } = await setup();
    const anna = client();
    const { planId } = await createPlanViaUi(anna, { visibility: "public", title: "Hill repeats" });
    const linkOnly = await createPlanViaUi(anna, { title: "Secret tempo" });
    await respondViaUi(new TestClient(app), planId, "Ben", "joined");

    const response = await client().get(`/nearby?${NEAR}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    const html = await response.text();
    expect(html).toContain(`href="/p/${planId}"`);
    expect(html).toContain("Hill repeats");
    expect(html).toContain(escaped(en("nearby.close")));
    expect(html).not.toContain(linkOnly.planId);
    // Never the exact start, its coordinates, or who is coming.
    expect(html).not.toContain("North gate");
    expect(html).not.toContain("48.16321");
    expect(html).not.toContain("Ben");
  });

  it("shows the form alone until a place is given, with the next two weeks", async () => {
    const { client } = await setup();
    const html = await (await client().get("/nearby")).text();
    expect(html).toContain('<form method="get" action="/nearby"');
    expect(html).toContain('name="from" value="2026-06-01" type="date"');
    expect(html).not.toContain(escaped(en("nearby.results", { count: 0 })));
  });

  it("searches around a typed place, and says when it is not found", async () => {
    const { client } = await setup();
    await createPlanViaUi(client(), {
      visibility: "public",
      exactLat: "",
      exactLng: "",
      exactDescription: "",
      areaLat: "48.11",
      areaLng: "11.56",
    });
    const viewer = client();
    // On to the place's rounded point: the typed text leaves the address (decision D35).
    const typed = await viewer.get("/nearby?place=Flaucher&radius=5&distanceFrom=");
    expect(typed.status).toBe(303);
    const location = typed.headers.get("location") ?? "";
    expect(location).toBe("/nearby?lat=48.12&lng=11.56&radius=5");
    const found = await (await viewer.get(location)).text();
    expect(found).toContain(escaped(en("nearby.results", { count: 1 })));
    expect(found).not.toContain("Flaucher&");
    const missing = await (await viewer.get("/nearby?place=Atlantis")).text();
    expect(missing).toContain(escaped(en("nearby.placeNotFound")));
    // The place stays in the field, to correct it.
    expect(missing).toContain('value="Atlantis"');
  });

  it("shows the results first, the filters folded unless one is set", async () => {
    const { client } = await setup();
    await createPlanViaUi(client(), { visibility: "public" });
    const plain = await (await client().get(`/nearby?${NEAR}`)).text();
    const main = plain.slice(plain.indexOf("<main"));
    expect(main.indexOf('class="nearby-results"')).toBeLessThan(main.indexOf("<form"));
    expect(plain).toContain('<details class="nearby-filters">');
    const filtered = await (await client().get(`/nearby?${NEAR}&activity=ride`)).text();
    expect(filtered).toContain('<details class="nearby-filters" open="">');
    // Chosen days are filters too: they show.
    const days = await (await client().get(`/nearby?${NEAR}&from=2026-06-05`)).text();
    expect(days).toContain('<details class="nearby-filters" open="">');
  });

  it("shows what it cannot read on the field, named for screen readers", async () => {
    const { client } = await setup();
    const html = await (await client().get(`/nearby?${NEAR}&from=2026-06-10&to=2026-06-05`)).text();
    expect(html).toContain(escaped(en("field.range_invalid")));
    expect(html).toContain('aria-invalid="true" aria-describedby="nearby-to-error"');
    expect(html).toContain('id="nearby-to-error"');
  });

  it("gives back only a valid point, never more precise than the grid", async () => {
    const { client } = await setup();
    const invalid = await (await client().get("/nearby?lat=48.23456&lng=999")).text();
    expect(invalid).toContain(escaped(en("field.coordinates_invalid")));
    const single = await (await client().get("/nearby?lat=48.23456")).text();
    for (const html of [invalid, single]) {
      expect(html).not.toContain("48.23456");
      expect(html).toContain('name="lat" value=""');
    }
  });

  it("returns from a units switch without the filters typed in the old units", async () => {
    const { client } = await setup();
    const html = await (
      await client().get(`/nearby?${NEAR}&distanceFrom=10&paceFrom=5:00&activity=run&radius=10`)
    ).text();
    expect(html).toContain('name="returnTo" value="/nearby?lat=48.16&amp;lng=11.6&amp;radius=10');
    expect(html).not.toMatch(/name="returnTo" value="[^"]*distanceFrom/);
    expect(html).not.toMatch(/name="returnTo" value="[^"]*paceFrom/);
  });

  it("is rate limited, counting searches only", async () => {
    const { client } = await setup();
    const viewer = client();
    for (let i = 0; i < 25; i++) expect((await viewer.get("/nearby")).status).toBe(200);
    for (let i = 0; i < 20; i++) expect((await viewer.get(`/nearby?${NEAR}`)).status).toBe(200);
    expect((await viewer.get(`/nearby?${NEAR}`)).status).toBe(429);
    // A typed place also counts against place search (spec 3.9): 10 at once.
    const typer = client();
    for (let i = 0; i < 10; i++)
      expect((await typer.get("/nearby?place=Atlantis")).status).toBe(200);
    expect((await typer.get("/nearby?place=Atlantis")).status).toBe(429);
    // The form itself stays reachable.
    expect((await viewer.get("/nearby")).status).toBe(200);
  });

  it("says nothing can be found where no plan can be public", async () => {
    const { client } = await setup({});
    const html = await (await client().get(`/nearby?${NEAR}`)).text();
    expect(html).toContain(escaped(en("nearby.nothingPublic")));
    expect(html).not.toContain('action="/nearby"');
  });

  it("is linked from the home page, the menu and the privacy notice", async () => {
    const { client } = await setup();
    const home = await (await client().get("/")).text();
    expect(home).toContain(`<a href="/nearby">${escaped(en("home.nearby"))}</a>`);
    expect(home).toContain(`<a href="/nearby">${escaped(en("layout.nearby"))}</a>`);
    const privacy = (await (await client().get("/privacy")).text()).replaceAll("&#39;", "'");
    expect(privacy).toContain(en("privacy.nearby"));
  });
});

describe("Nearby turned off (NEARBY_ENABLED=false)", () => {
  it("offers no public plans: in 0.8 they would be listed nowhere (decision I59)", async () => {
    const { client } = await setup({ ...PUBLIC, NEARBY_ENABLED: "false" });
    const form = await (await client().get("/new")).text();
    // Public is not offered: without Nearby and without a profile, nothing would find it.
    expect(form).not.toContain('name="visibility" value="public"');
    const ben = client();
    const refused = await ben.postForm("/new", {
      ...(await ben.hiddenFields("/new")),
      ...planForm({ visibility: "public" }),
    });
    expect(refused.status).toBe(422);
    const privacy = (await (await client().get("/privacy")).text()).replaceAll("&#39;", "'");
    expect(privacy).not.toContain(en("privacy.publicPlans"));
  });

  it("has no page, no link and no privacy line", async () => {
    const { client } = await setup({ ...PUBLIC, NEARBY_ENABLED: "false" });
    expect((await client().get(`/nearby?${NEAR}`)).status).toBe(404);
    const home = await (await client().get("/")).text();
    expect(home).not.toContain('href="/nearby"');
    expect(await (await client().get("/privacy")).text()).not.toContain(
      escaped(en("privacy.nearby")).slice(0, 40),
    );
  });
});

describe("the viewer's place (decision D35)", () => {
  it("is neither stored nor logged, whatever precision the browser sent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rendezroute-nearby-"));
    dirs.push(dir);
    const path = join(dir, "rendezroute.db");
    const { client, logs, database } = await setup(PUBLIC, path);
    await createPlanViaUi(client(), { visibility: "public" });
    const viewer = client();
    const html = await (await viewer.get("/nearby?lat=48.23456&lng=11.67891&radius=50")).text();
    expect(html).toContain(escaped(en("nearby.results", { count: 1 })));
    // A typed place: looked up, then only its rounded point is shown (Flaucher → 48.12, 11.56).
    const typed = await viewer.get("/nearby?place=Flaucher&radius=50");
    const results = await (await viewer.get(typed.headers.get("location") ?? "")).text();
    expect(results).not.toContain("Flaucher&");
    // Only the rounded point is shown back, for the next search.
    expect(html).toContain('name="lat" value="48.24"');
    expect(html).toContain('name="lng" value="11.68"');
    expect(html).not.toContain("48.23456");
    const raw = [path, `${path}-wal`]
      .map((file) => {
        try {
          return readFileSync(file).toString("latin1");
        } catch {
          return "";
        }
      })
      .join("");
    const logText = logs.join("\n");
    for (const trace of ["48.23456", "11.67891", "Flaucher"]) {
      expect(raw).not.toContain(trace);
      expect(logText).not.toContain(trace);
    }
    // The rounded points are short: in the file and in the logs (`"time":"…:48.126Z"`), a timestamp must not match.
    for (const rounded of ["48.24", "11.68", "48.12", "11.56"]) {
      expect(hasStandalone(raw, rounded)).toBe(false);
      expect(hasStandalone(logText, rounded)).toBe(false);
    }
    await database.close();
  });
});
