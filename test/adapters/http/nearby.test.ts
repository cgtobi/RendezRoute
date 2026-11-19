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

  it("offers hikes in the activity filter and filters by them", async () => {
    const { client } = await setup();
    const { planId: hikeId } = await createPlanViaUi(client(), {
      visibility: "public",
      title: "Ridge walk",
      activity: "hike",
      paceFrom: "11:00",
      paceTo: "12:30",
    });
    const { planId: runId } = await createPlanViaUi(client(), {
      visibility: "public",
      title: "Park run",
    });
    const all = await (await client().get(`/nearby?${NEAR}`)).text();
    expect(all).toContain(`<option value="hike">${en("activity.hike")}</option>`);
    expect(all).toContain(`href="/p/${hikeId}"`);
    expect(all).toContain(`href="/p/${runId}"`);
    const hikes = await (await client().get(`/nearby?${NEAR}&activity=hike`)).text();
    expect(hikes).toContain(`<option value="hike" selected="">${en("activity.hike")}</option>`);
    expect(hikes).toContain(`href="/p/${hikeId}"`);
    expect(hikes).not.toContain(`href="/p/${runId}"`);
    const byPace = await (
      await client().get(`/nearby?${NEAR}&activity=hike&paceFrom=11:30&paceTo=12:00`)
    ).text();
    expect(byPace).toContain(`href="/p/${hikeId}"`);
  });

  it("shows the form alone until a place is given, with the next two weeks", async () => {
    const { client } = await setup();
    const html = await (await client().get("/nearby")).text();
    expect(html).toContain('<form method="get" action="/nearby"');
    expect(html).toContain('name="from" value="2026-06-01" type="date"');
    expect(html).not.toContain(escaped(en("nearby.results", { count: 0 })));
  });

  it("shows example placeholders in the place and distance fields (D74)", async () => {
    const { client } = await setup();
    const html = await (await client().get("/nearby")).text();
    const tag = (name: string) =>
      new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(html)?.[0] ?? "";
    expect(tag("place")).toContain(`placeholder="${escaped(en("placeholder.place"))}"`);
    expect(tag("distanceFrom")).toContain(`placeholder="${en("placeholder.distanceFrom")}"`);
    expect(tag("distanceTo")).toContain(`placeholder="${en("placeholder.distanceTo")}"`);
    // The pace unit depends on the activity, so those two stay without an example.
    expect(tag("paceFrom")).not.toContain("placeholder");
    expect(tag("paceTo")).not.toContain("placeholder");
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

describe("Nearby's full-screen map (ADR 008)", () => {
  const template = (html: string) =>
    /<template data-map-dialog="nearby"[^>]*>[\s\S]*?<\/template>/.exec(html)?.[0] ?? "";

  it("puts the template right after the page map, with its labels, search, Done and locate", async () => {
    const { client } = await setup();
    const html = await (await client().get("/nearby")).text();
    // Next to the map: the script finds it as the map's next sibling.
    expect(html).toMatch(
      /<div[^>]*data-nearby-map=""[^>]*><\/div><template data-map-dialog="nearby"/,
    );
    const found = template(html);
    expect(found).toContain('data-open-label="Show the map full screen"');
    expect(found).toMatch(
      /<dialog class="map-dialog map-dialog-nearby" aria-label="Full-screen map" data-close-label="Close full-screen map"/,
    );
    expect(found).toMatch(
      /<div class="map map-dialog-map" tabindex="0" autofocus="" role="application" aria-label="Tap the map to search around that spot"><\/div>/,
    );
    // The place search: no form name, a visually hidden label, the magnifier, a status line.
    expect(found).toContain('<label class="visually-hidden" for="map-dialog-place">Place</label>');
    const input = /<input[^>]*id="map-dialog-place"[^>]*>/.exec(found)?.[0] ?? "";
    expect(input).toContain('type="search"');
    expect(input).toContain('autocomplete="off"');
    expect(input).toContain('maxlength="100"');
    expect(input).toContain('enterkeyhint="search"');
    expect(input).toContain(`placeholder="${escaped(en("placeholder.place"))}"`);
    expect(input).not.toContain("name=");
    expect(found).toContain('<span class="visually-hidden">Search</span>');
    expect(found).toMatch(
      /<p class="hint" role="status" data-search-status="" data-no-results="No places found\." data-unavailable="Place search is not available right now\."><\/p>/,
    );
    // The foot: Done first, the chosen-spot line and "Use my location", both hidden.
    expect(found).toContain(
      '<button type="button" class="map-dialog-done" data-map-dialog-close="">Done</button>',
    );
    expect(found).toMatch(/<p class="map-dialog-status" data-nearby-status="" hidden="">/);
    expect(found).toContain(escaped(en("nearby.atPoint")));
    expect(found).toMatch(
      /<button type="button" class="secondary" data-dialog-locate="" data-locate-denied="Location access was refused" data-locate-unavailable="Your position is not available" hidden="">Use my location<\/button>/,
    );
    // No control in it is part of the search form.
    expect(found).not.toMatch(/\sname="/);
    expect(found).not.toContain("data-nearby-locate");
    expect(html.split("data-map-dialog=").length - 1).toBe(1);
  });

  it("speaks German and French", async () => {
    const { app } = await setup();
    for (const [language, open, label] of [
      ["de", "Karte im Vollbild zeigen", "Vollbildkarte"],
      ["fr", "Afficher la carte en plein écran", "Carte en plein écran"],
    ] as const) {
      const response = await app.request("/nearby", { headers: { "accept-language": language } });
      const found = template(await response.text());
      expect(found).toContain(`data-open-label="${open}"`);
      expect(found).toContain(`aria-label="${label}"`);
    }
  });

  it("holds no coordinates, even with a point in the address", async () => {
    const { client } = await setup();
    const html = await (await client().get(`/nearby?${NEAR}`)).text();
    const found = template(html);
    expect(found).not.toBe("");
    expect(found).not.toMatch(/data-(area|exact|lat|lng)/);
    expect(found).not.toMatch(/48[.,]16|11[.,]6\b|value="/);
  });

  it("has no place search without the geocoder", async () => {
    const { client } = await setup({ ...PUBLIC, GEOCODER_ENABLED: "false" });
    const found = template(await (await client().get("/nearby")).text());
    expect(found).toContain('<dialog class="map-dialog map-dialog-nearby"');
    expect(found).not.toContain("map-dialog-place");
    expect(found).not.toContain("data-search-status");
    expect(found).toContain("data-dialog-locate");
  });

  it("gives the page's Use my location the translated reasons it shows once refused", async () => {
    const { app } = await setup();
    for (const [language, denied, unavailable] of [
      ["en", "Location access was refused", "Your position is not available"],
      ["de", "Der Standortzugriff wurde verweigert", "Deine Position ist nicht verfügbar"],
    ] as const) {
      const response = await app.request("/nearby", { headers: { "accept-language": language } });
      const button = /<button[^>]*data-nearby-locate=""[^>]*>/.exec(await response.text())?.[0];
      expect(button).toContain(`data-locate-denied="${denied}"`);
      expect(button).toContain(`data-locate-unavailable="${unavailable}"`);
      // aria-disabled is set by the script on failure; the markup never disables it.
      expect(button).not.toMatch(/\sdisabled|aria-disabled/);
    }
  });

  it("is absent with maps disabled", async () => {
    const { client } = await setup({ ...PUBLIC, MAPS_ENABLED: "false" });
    const html = await (await client().get("/nearby")).text();
    expect(html).not.toContain("data-map-dialog");
    expect(html).not.toContain("map-dialog");
    expect(html).not.toContain("<template");
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
