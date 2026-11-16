import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { FakeGeocoder } from "../../fakes/geocoder.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { sampleGpx } from "../../support/gpx.ts";
import { createPlanViaUi, planForm, respondViaUi } from "../../support/plans.ts";

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

async function page(env: Record<string, string> = {}, path = "/new") {
  const test = await createTestApp({ env });
  return (await new TestClient(test.app).get(path)).text();
}

describe("form map and place search (spec 3.9, decision D12)", () => {
  it("adds the map picker, place search and the locate control's title, loaded from bundled files", async () => {
    const html = await page();
    expect(html).toContain(`data-tile-url="${TILE_URL}"`);
    expect(html).toContain('data-attribution="© OpenStreetMap contributors"');
    expect(html).toMatch(/<div[^>]*data-map-picker=""[^>]*hidden=""/);
    expect(html).toMatch(/<div[^>]*data-place-search=""[^>]*data-endpoint="\/geocode"/);
    expect(html).toMatch(/<div[^>]*data-map-picker=""[^>]*data-locate-title="Find my location"/);
    expect(html).not.toContain("data-locate=");
    expect(html).toContain('<script src="/static/build/map.js" type="module"></script>');
    expect(html).toContain('<link rel="stylesheet" href="/static/build/map.css"/>');
  });

  it("offers a two-segment mode switch under the map, on the public area by default (D66)", async () => {
    const html = await page();
    expect(html).toMatch(/<input[^>]*type="radio"[^>]*name="mapMode"[^>]*value="area"[^>]*checked/);
    expect(html).toMatch(
      /<input[^>]*type="radio"[^>]*name="mapMode"[^>]*value="exact"(?![^>]*checked)/,
    );
    expect(html).toContain("<span>Public area</span>");
    expect(html).toContain("<span>Exact start</span>");
    expect(html).toContain('<legend class="visually-hidden">Tapping the map sets</legend>');
    // The caption is server-rendered for the default mode and swapped by the script.
    const caption = /<p[^>]*data-map-caption=""[^>]*>[^<]*<\/p>/.exec(html)?.[0] ?? "";
    expect(caption).toContain('aria-live="polite"');
    expect(caption).toContain(
      "Tap the map to set the public meeting area (about 1 km). Everyone sees it.",
    );
    expect(caption).toContain(
      'data-caption-exact="Tap the map to set the exact start. Only people who join can see it."',
    );
    expect(caption).not.toContain("accept");
    expect(caption).toContain(
      'data-caption-area-follows="The public area follows the exact start (about 1 km around it). Remove the exact point to choose another area."',
    );
    // A refused locate control says why from these texts.
    expect(html).toMatch(
      /<div[^>]*data-map-picker=""[^>]*data-locate-denied="Location access was refused"/,
    );
    expect(html).toMatch(
      /<div[^>]*data-map-picker=""[^>]*data-locate-unavailable="Your position is not available"/,
    );
    expect(html.indexOf('class="map"')).toBeLessThan(html.indexOf('name="mapMode"'));
  });

  it("renders an area readout with Remove under the caption, hidden until the script reveals it", async () => {
    const html = await page();
    const readout = /<div[^>]*data-area-readout=""[^>]*>[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
    expect(readout).toMatch(/^<div[^>]*hidden/);
    expect(readout).toMatch(/<p[^>]*data-area-set=""[^>]*hidden[^>]*>/);
    expect(readout).toContain("Public area set on the map");
    expect(readout).toMatch(/<button[^>]*data-area-remove=""[^>]*>Remove<\/button>/);
    expect(readout).toMatch(
      /<p[^>]*data-area-none=""[^>]*tabindex="-1"[^>]*>No public area set on the map<\/p>/,
    );
    expect(html.indexOf("data-map-caption")).toBeLessThan(html.indexOf("data-area-readout"));
    expect(html.indexOf("data-area-readout")).toBeLessThan(html.indexOf('id="field-areaLabel"'));
    // The coordinate inputs stay in the markup, visible until the script hides them.
    expect(html).toMatch(/<input[^>]*name="areaLat"/);
    expect(html).not.toMatch(/<details[^>]*data-area-fields=""[^>]*hidden/);
  });

  it("has no area readout when maps are disabled", async () => {
    expect(await page({ MAPS_ENABLED: "false" })).not.toContain("data-area-readout");
  });

  it("offers area coordinates as form fields, so they work without JavaScript and survive edits", async () => {
    const html = await page();
    expect(html).toContain('name="areaLat"');
    expect(html).toContain('name="areaLng"');
  });

  it("leaves out the map, switch and locate control when maps are disabled, keeping typed coordinates", async () => {
    const html = await page({ MAPS_ENABLED: "false" });
    expect(html).not.toContain("data-map-picker");
    expect(html).not.toContain("tile.openstreetmap.org");
    expect(html).not.toContain("data-locate");
    expect(html).not.toContain("mapMode");
    expect(html).not.toContain("data-map-caption");
    expect(html).not.toContain("data-exact-readout");
    expect(html).toContain('name="areaLat"');
    expect(html).toContain('name="exactLat"');
    expect(html).toContain('name="exactLng"');
  });

  it("renders no default center or zoom unless the operator set a center (D63)", async () => {
    const html = await page();
    expect(html).toMatch(/<div[^>]*data-map-picker=""/);
    expect(html).not.toContain("data-default-center");
    expect(html).not.toContain("data-default-zoom");
    // A zoom alone is accepted but unused: the client then follows the browser's time zone.
    const zoomOnly = await page({ DEFAULT_MAP_ZOOM: "9" });
    expect(zoomOnly).not.toContain("data-default-center");
    expect(zoomOnly).not.toContain("data-default-zoom");
  });

  it("carries the operator's default center and zoom on the picker (D63)", async () => {
    const html = await page({ DEFAULT_MAP_CENTER: "48.1374,11.5755", DEFAULT_MAP_ZOOM: "9" });
    const picker = /<div[^>]*data-map-picker=""[^>]*>/.exec(html)?.[0] ?? "";
    expect(picker).toContain('data-default-center="48.1374,11.5755"');
    expect(picker).toContain('data-default-zoom="9"');
    // With only a center, the zoom is the default 6.
    const centerOnly = await page({ DEFAULT_MAP_CENTER: "48.1374, 11.5755" });
    expect(centerOnly).toContain('data-default-center="48.1374,11.5755"');
    expect(centerOnly).toContain('data-default-zoom="6"');
  });

  it("leaves out the default center without maps (D63)", async () => {
    const html = await page({ MAPS_ENABLED: "false", DEFAULT_MAP_CENTER: "48.1374,11.5755" });
    expect(html).not.toContain("data-default-center");
  });

  it("leaves out place search when the geocoder is disabled", async () => {
    expect(await page({ GEOCODER_ENABLED: "false" })).not.toContain("data-place-search");
    expect(await page({ CONTACT_EMAIL: "" })).not.toContain("data-place-search");
  });
});

describe("plan map (spec 3.6, decision D12)", () => {
  async function setup(env: Record<string, string> = {}) {
    const test = await createTestApp({ env });
    const host = new TestClient(test.app);
    const hidden = await host.hiddenFields("/new");
    const created = await host.postMultipart(
      "/new",
      { ...hidden, ...planForm() },
      { gpx: { name: "run.gpx", content: sampleGpx() } },
    );
    const planId = /\/p\/([A-Za-z0-9_-]{22})/.exec(await created.text())?.[1] ?? "";
    return { ...test, host, planId, newClient: () => new TestClient(test.app) };
  }
  const mapTag = (html: string) => /<div[^>]*data-plan-map=""[^>]*>/.exec(html)?.[0] ?? "";

  it("shows viewers only the public point", async () => {
    const { planId, newClient } = await setup();
    const tag = mapTag(await (await newClient().get(`/p/${planId}`)).text());
    expect(tag).toContain('data-area-lat="48.16"');
    expect(tag).toContain('data-area-lng="11.6"');
    expect(tag).not.toContain("data-exact");
    expect(tag).not.toContain("data-route-url");
  });

  it("does not carry the default center or zoom of the form map (D63)", async () => {
    const { planId, newClient } = await setup({
      DEFAULT_MAP_CENTER: "48.1374,11.5755",
      DEFAULT_MAP_ZOOM: "9",
    });
    const html = await (await newClient().get(`/p/${planId}`)).text();
    expect(mapTag(html)).not.toBe("");
    expect(html).not.toContain("data-default-center");
    expect(html).not.toContain("data-default-zoom");
  });

  it("gives participants and the host the exact start and the route", async () => {
    const { host, planId, newClient } = await setup();
    const ben = newClient();
    await respondViaUi(ben, planId, "Ben", "joined");
    for (const client of [host, ben]) {
      const tag = mapTag(await (await client.get(`/p/${planId}`)).text());
      expect(tag).toContain('data-exact-lat="48.16321"');
      expect(tag).toContain(`data-route-url="/p/${planId}/route.geojson"`);
    }
  });

  it("is absent with maps disabled", async () => {
    const { host, planId } = await setup({ MAPS_ENABLED: "false" });
    expect(await (await host.get(`/p/${planId}`)).text()).not.toContain("data-plan-map");
  });

  it("serves the route as GeoJSON to participants and the host only (decision D12)", async () => {
    const { host, planId, newClient } = await setup();
    const response = await host.get(`/p/${planId}/route.geojson`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/geo+json");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const geojson = (await response.json()) as { type: string; coordinates: number[][][] };
    expect(geojson.type).toBe("MultiLineString");
    expect(geojson.coordinates[0]?.[0]).toEqual([10.98765, 47.12345, 800]);
    expect((await newClient().get(`/p/${planId}/route.geojson`)).status).toBe(404);
  });
});

describe("POST /geocode (spec 3.9, decision D12)", () => {
  async function search(body: unknown, { env = {}, withCsrf = true } = {}) {
    const test = await createTestApp({ env });
    const client = new TestClient(test.app);
    const csrf = (await client.hiddenFields("/new"))._csrf ?? "";
    const response = await client.request("/geocode", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(withCsrf ? { "x-csrf-token": csrf } : {}),
      },
      body: JSON.stringify(body),
    });
    return { response, geocoder: test.geocoder };
  }

  it("returns places for the request language", async () => {
    const { response, geocoder } = await search({ q: "Flaucher" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      places: [{ label: "Flaucher, Isar, Munich", lat: 48.1107, lng: 11.5582 }],
    });
    expect(geocoder.calls).toEqual([{ query: "Flaucher", language: "en" }]);
  });

  it("requires the CSRF token, so it cannot serve as an open proxy", async () => {
    const { response, geocoder } = await search({ q: "Flaucher" }, { withCsrf: false });
    expect(response.status).toBe(403);
    expect(geocoder.calls).toHaveLength(0);
  });

  it("rejects bad queries and reports an unavailable service", async () => {
    expect((await search({ q: "x" })).response.status).toBe(400);
    expect((await search("not an object")).response.status).toBe(400);
    const test = await createTestApp();
    test.geocoder.failing = true;
    const client = new TestClient(test.app);
    const csrf = (await client.hiddenFields("/new"))._csrf ?? "";
    const response = await client.request("/geocode", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ q: "Flaucher" }),
    });
    expect(response.status).toBe(503);
  });

  it("does not exist when the geocoder is disabled", async () => {
    expect(
      (await search({ q: "Flaucher" }, { env: { GEOCODER_ENABLED: "false" } })).response.status,
    ).toBe(404);
  });
});

describe("POST /geocode/reverse (decision D70)", () => {
  async function reverse(body: unknown, { env = {}, withCsrf = true, failing = false } = {}) {
    const test = await createTestApp({
      env,
      geocoder: new FakeGeocoder({}, { "48.11,11.56": "Sendling, München" }),
    });
    test.geocoder.failing = failing;
    const client = new TestClient(test.app);
    const csrf = (await client.hiddenFields("/new"))._csrf ?? "";
    const response = await client.request("/geocode/reverse", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(withCsrf ? { "x-csrf-token": csrf } : {}),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    return { response, geocoder: test.geocoder };
  }

  it("answers with a label and never caches the response", async () => {
    const { response, geocoder } = await reverse({ lat: 48.11, lng: 11.56 });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ label: "Sendling, München" });
    expect(geocoder.reverseCalls).toEqual([{ lat: 48.11, lng: 11.56, language: "en" }]);
  });

  it("snaps raw coordinates to the grid, so the geocoder never sees them", async () => {
    const { response, geocoder } = await reverse({ lat: 48.113456, lng: 11.561234 });
    expect(await response.json()).toEqual({ label: "Sendling, München" });
    expect(geocoder.reverseCalls).toEqual([{ lat: 48.11, lng: 11.56, language: "en" }]);
    expect(JSON.stringify(geocoder.reverseCalls)).not.toMatch(/48\.113|11\.561/);
  });

  it("answers null for a place without a name", async () => {
    const { response } = await reverse({ lat: 10, lng: 10 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ label: null });
  });

  it("requires the CSRF token, with no geocoder call without it", async () => {
    const { response, geocoder } = await reverse({ lat: 48.11, lng: 11.56 }, { withCsrf: false });
    expect(response.status).toBe(403);
    expect(geocoder.reverseCalls).toHaveLength(0);
  });

  it("rejects out-of-range, non-number and missing coordinates", async () => {
    for (const body of [
      { lat: 91, lng: 0 },
      { lat: 0, lng: -181 },
      { lat: "48.11", lng: "11.56" },
      { lat: 48.11 },
      { lng: 11.56 },
      { lat: null, lng: 11.56 },
      "not json",
      "[]",
      '"text"',
    ]) {
      const { response, geocoder } = await reverse(body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "bad_request" });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(geocoder.reverseCalls).toHaveLength(0);
    }
  });

  it("reports an unavailable service", async () => {
    const { response } = await reverse({ lat: 48.11, lng: 11.56 }, { failing: true });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
  });

  it("does not exist when the geocoder is disabled", async () => {
    const { response } = await reverse(
      { lat: 48.11, lng: 11.56 },
      { env: { GEOCODER_ENABLED: "false" } },
    );
    expect(response.status).toBe(404);
  });
});

describe("label suggestion markup (decision D70)", () => {
  it("offers the lookup endpoint and a hidden hint only with maps and the geocoder", async () => {
    const html = await page();
    expect(html).toMatch(
      /<div[^>]*data-map-picker=""[^>]*data-suggest-endpoint="\/geocode\/reverse"/,
    );
    const hint = /<p[^>]*data-label-suggested=""[^>]*>[^<]*<\/p>/.exec(html)?.[0] ?? "";
    expect(hint).toMatch(/^<p[^>]*class="hint"/);
    expect(hint).toContain("hidden");
    expect(hint).toContain('role="status"');
    expect(hint).toContain("Suggested from the map. Change it if you like.");
    expect(html.indexOf('id="field-areaLabel"')).toBeLessThan(html.indexOf("data-label-suggested"));
  });

  it("has neither without a geocoder", async () => {
    for (const env of [{ GEOCODER_ENABLED: "false" }, { CONTACT_EMAIL: "" }]) {
      const html = await page(env);
      expect(html).toContain("data-map-picker");
      expect(html).not.toContain("data-suggest-endpoint");
      expect(html).not.toContain("data-label-suggested");
      expect(html).not.toContain("Suggested from the map");
    }
  });

  it("has neither with maps disabled", async () => {
    const html = await page({ MAPS_ENABLED: "false" });
    expect(html).not.toContain("data-suggest-endpoint");
    expect(html).not.toContain("data-label-suggested");
  });

  it("has the hint on the edit form too", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host);
    const html = await (await host.get(`/p/${planId}/host`)).text();
    expect(html).toContain("data-label-suggested");
    expect(html).toContain('data-suggest-endpoint="/geocode/reverse"');
  });
});

describe("area coordinates survive host edits (fix for a step 5 gap)", () => {
  it("keeps the area point of a plan without exact start coordinates", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host, {
      exactLat: "",
      exactLng: "",
      areaLat: "48.15432",
      areaLng: "11.58861",
    });
    const html = await (await host.get(`/p/${planId}/host`)).text();
    const fields = {
      ...hiddenFields(html),
      ...planForm({
        exactLat: "",
        exactLng: "",
        areaLat: "48.15",
        areaLng: "11.59",
        title: "Renamed",
      }),
    };
    expect((await host.postForm(`/p/${planId}/host`, fields)).status).toBe(303);
    expect(test.database.sqlite.prepare("select area_lat, area_lng from plans").get()).toEqual({
      area_lat: 48.15,
      area_lng: 11.59,
    });
    expect(html).toContain('name="areaLat" value="48.15"');
  });
});

describe("no third-party loading in browsers (spec 2, 2b CI check)", () => {
  const EXTERNAL =
    /<script[^>]+src="(?:https?:)?\/\/|<link[^>]+href="(?:https?:)?\/\/[^"]*"[^>]*>|@import\s+(?:url\()?["']?(?:https?:)?\/\/|url\(["']?(?:https?:)?\/\//i;

  it("pages reference only same-origin scripts, stylesheets and fonts", async () => {
    const test = await createTestApp();
    const host = new TestClient(test.app);
    const { planId } = await createPlanViaUi(host);
    for (const path of ["/", "/new", `/p/${planId}`, `/p/${planId}/host`, `/p/${planId}/me`]) {
      const html = await (await host.get(path)).text();
      expect({ path, external: EXTERNAL.exec(html)?.[0] }).toEqual({ path, external: undefined });
    }
  });

  it("bundled stylesheets and scripts load nothing from other origins", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(css|js)$/.test(entry.name)) files.push(path);
      }
    };
    walk(join(import.meta.dirname, "../../../public"));
    expect(files.some((file) => file.endsWith("app.css"))).toBe(true);
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      expect({ file, external: EXTERNAL.exec(content)?.[0] }).toEqual({
        file,
        external: undefined,
      });
    }
  });
});
