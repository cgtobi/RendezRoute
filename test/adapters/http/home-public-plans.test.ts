// The upcoming public plans on the home page (spec 7): public fields only, as in Nearby.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { createTestApp } from "../../support/app.ts";
import { TestClient } from "../../support/client.ts";
import { sampleGpx } from "../../support/gpx.ts";
import { createPlanViaUi, createPlanWithRouteViaUi, respondViaUi } from "../../support/plans.ts";
import { hasStandalone } from "../../support/raw-scan.ts";

const en = translator("en");
const PUBLIC = { PUBLIC_REQUIRES_LOGIN: "false" };

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function setup(env: Record<string, string> = PUBLIC, databasePath?: string) {
  const test = await createTestApp({
    env,
    ...(databasePath === undefined ? {} : { databasePath }),
  });
  return { ...test, client: () => new TestClient(test.app) };
}

describe("the home page's upcoming public plans", () => {
  it("lists public plans with public fields only, not cached", async () => {
    const { client, app } = await setup();
    const anna = client();
    const { planId } = await createPlanWithRouteViaUi(
      anna,
      { visibility: "public", title: "Hill repeats" },
      sampleGpx(),
    );
    const linkOnly = await createPlanViaUi(anna, { title: "Secret tempo" });
    const joined = await respondViaUi(new TestClient(app), planId, "Benedikta Quill", "joined");
    expect(joined.managePath).toBeDefined();

    const response = await client().get("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    const html = await response.text();
    expect(html).toContain(en("home.upcoming"));
    expect(html).toContain(`href="/p/${planId}"`);
    expect(html).toContain("Hill repeats");
    expect(html).not.toContain(linkOnly.planId);
    expect(html).not.toContain("Secret tempo");
    // Never what Nearby hides: exact start, coordinates, names, notes, the route.
    expect(html).not.toContain("North gate");
    expect(html).not.toContain("48.16321");
    expect(html).not.toContain("11.60147");
    expect(hasStandalone(html, "48.16")).toBe(false);
    expect(hasStandalone(html, "11.6")).toBe(false);
    expect(html).not.toContain("Benedikta Quill");
    expect(html).not.toContain("Anna");
    expect(html).not.toContain("Bring water");
    expect(html).not.toContain("route.gpx");
    expect(html).not.toContain("LineString");
    expect(html).not.toContain("47.12345");
    expect(html).not.toContain("10.98765");
  });

  it("lists plans that started within a week under Recently, newest first, and no others", async () => {
    const { client, clock } = await setup();
    const anna = client();
    const cancelled = await createPlanViaUi(anna, { visibility: "public", title: "Called off" });
    const host = `/p/${cancelled.planId}/host`;
    await anna.postForm(`${host}/cancel`, await anna.hiddenFields(host));
    const old = await createPlanViaUi(anna, {
      visibility: "public",
      title: "Long gone",
      date: "2026-06-03",
    });
    const recentOne = await createPlanViaUi(anna, {
      visibility: "public",
      title: "Just done",
      date: "2026-06-07",
    });
    const linkOnly = await createPlanViaUi(anna, { title: "Secret done", date: "2026-06-07" });
    const ahead = await createPlanViaUi(anna, {
      visibility: "public",
      title: "Still ahead",
      date: "2026-06-20",
    });
    clock.set("2026-06-10T12:00:00Z");
    const response = await client().get("/");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    const html = await response.text();
    const recentAt = html.indexOf(en("home.recent"));
    expect(recentAt).toBeGreaterThan(html.indexOf(en("home.upcoming")));
    const [coming, lately] = [html.slice(0, recentAt), html.slice(recentAt)];
    expect(coming).toContain(`href="/p/${ahead.planId}"`);
    expect(coming).not.toContain(recentOne.planId);
    expect(lately).toContain(`href="/p/${recentOne.planId}"`);
    expect(lately).not.toContain(ahead.planId);
    for (const hidden of [cancelled, old, linkOnly]) expect(html).not.toContain(hidden.planId);
    for (const title of ["Called off", "Long gone", "Secret done"]) {
      expect(html).not.toContain(title);
    }
    // The same privacy as Coming up.
    expect(html).not.toContain("North gate");
    expect(html).not.toContain("48.16321");
    expect(html).not.toContain("11.60147");
    expect(html).not.toContain("Anna");
  });

  it("shows only Recently when nothing is coming up", async () => {
    const { client, clock } = await setup();
    const { planId } = await createPlanWithRouteViaUi(
      client(),
      { visibility: "public", title: "Just done", date: "2026-06-07" },
      sampleGpx(),
    );
    clock.set("2026-06-08T12:00:00Z");
    const html = await (await client().get("/")).text();
    expect(html).toContain(en("home.recent"));
    expect(html).not.toContain(en("home.upcoming"));
    expect(html).toContain(`href="/p/${planId}"`);
    expect(html).not.toContain("route.gpx");
    expect(html).not.toContain("47.12345");
    expect(html).not.toContain("Bring water");
  });

  it("renders nothing, and does not change the headers, when there are no public plans", async () => {
    const { client } = await setup();
    await createPlanViaUi(client(), { title: "Secret tempo" });
    const response = await client().get("/");
    expect(response.headers.get("x-robots-tag")).toBeNull();
    expect(await response.text()).not.toContain(en("home.upcoming"));
  });

  it("is hidden when Nearby is off", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rendezroute-home-"));
    dirs.push(dir);
    const path = join(dir, "rendezroute.db");
    const on = await setup(PUBLIC, path);
    const { planId } = await createPlanViaUi(on.client(), {
      visibility: "public",
      title: "Hill repeats",
    });
    expect(await (await on.client().get("/")).text()).toContain(`href="/p/${planId}"`);
    await on.database.close();

    const off = await setup({ ...PUBLIC, NEARBY_ENABLED: "false" }, path);
    const html = await (await off.client().get("/")).text();
    expect(html).not.toContain(en("home.upcoming"));
    expect(html).not.toContain(en("home.recent"));
    expect(html).not.toContain(planId);
    expect(html).not.toContain("Hill repeats");
  });

  it("lists nothing when login is required and none is offered, as Nearby does", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rendezroute-home-"));
    dirs.push(dir);
    const path = join(dir, "rendezroute.db");
    const on = await setup(PUBLIC, path);
    const { planId } = await createPlanViaUi(on.client(), { visibility: "public" });
    await on.database.close();

    const locked = await setup({ PUBLIC_REQUIRES_LOGIN: "true" }, path);
    const html = await (await locked.client().get("/")).text();
    expect(html).not.toContain(en("home.upcoming"));
    expect(html).not.toContain(planId);
  });
});
