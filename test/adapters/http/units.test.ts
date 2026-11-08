import { describe, expect, it } from "vite-plus/test";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { createPlanViaUi, planForm } from "../../support/plans.ts";

async function setup() {
  const test = await createTestApp();
  return { ...test, client: new TestClient(test.app) };
}

async function chooseUnits(client: TestClient, units: string, returnTo = "/new") {
  const hidden = await client.hiddenFields(returnTo);
  return client.postForm("/units", { ...hidden, units, returnTo });
}

describe("units (spec 2 i18n, decision P5)", () => {
  it("are metric by default, without a cookie", async () => {
    const { client } = await setup();
    const { planId } = await createPlanViaUi(client, { elevationGainM: "350" });
    const response = await client.get(`/p/${planId}`);
    const page = await response.text();
    expect(page).toContain("12.5 km");
    expect(page).toContain("350 m");
    expect(page).toContain("5:30–6:00 min/km");
    expect(response.headers.getSetCookie().join()).not.toContain("rr-units");
  });

  it("are chosen with a footer form that works without JavaScript", async () => {
    const { client } = await setup();
    const page = await (await client.get("/new")).text();
    const form = /<form[^>]*action="\/units"[\s\S]*?<\/form>/.exec(page)?.[0] ?? "";
    expect(form).toContain('name="_csrf"');
    expect(form).toContain('name="returnTo" value="/new"');
    expect(form).toContain('<option value="metric" selected="">');
    expect(form).toContain('<option value="imperial">');
  });

  it("are stored in their own cookie holding nothing else", async () => {
    const { client } = await setup();
    const response = await chooseUnits(client, "imperial");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/new");
    const cookie = response.headers.getSetCookie().find((c) => c.startsWith("__Host-rr-units="));
    expect(cookie).toBe(
      "__Host-rr-units=imperial; Max-Age=34560000; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
  });

  it("rejects unknown units and requests without the CSRF token", async () => {
    const { client } = await setup();
    const hidden = await client.hiddenFields("/new");
    expect((await client.postForm("/units", { ...hidden, units: "nautical" })).status).toBe(400);
    expect((await client.postForm("/units", { units: "imperial" })).status).toBe(403);
  });

  it("show miles, feet and pace per mile in imperial", async () => {
    const { client } = await setup();
    const { planId } = await createPlanViaUi(client, { elevationGainM: "350" });
    await chooseUnits(client, "imperial", `/p/${planId}`);
    const page = await (await client.get(`/p/${planId}`)).text();
    expect(page).toContain("7.8 mi");
    expect(page).toContain("1,148 ft");
    expect(page).toContain("8:51–9:39 min/mi");
  });

  it("show speeds in mph for rides", async () => {
    const { client } = await setup();
    const { planId } = await createPlanViaUi(client, {
      activity: "ride",
      paceFrom: "25",
      paceTo: "28",
    });
    await chooseUnits(client, "imperial", `/p/${planId}`);
    expect(await (await client.get(`/p/${planId}`)).text()).toContain("16–17 mph");
  });

  it("are used for entering distance, elevation and pace", async () => {
    const { client, database } = await setup();
    await chooseUnits(client, "imperial");
    const html = await (await client.get("/new")).text();
    expect(html).toContain("Distance (mi, optional)");
    expect(html).toContain("Elevation gain (ft, optional)");
    expect(html).toContain("Hide about 0.3 mi at each end");

    const created = await client.postForm("/new", {
      ...hiddenFields(html),
      ...planForm({ distanceKm: "10", elevationGainM: "1000", paceFrom: "8:00", paceTo: "8:00" }),
    });
    expect(created.status).toBe(200);
    expect(
      database.sqlite
        .prepare("select distance_m, elevation_gain_m, pace_min_s_per_km from plans")
        .get(),
    ).toEqual({ distance_m: 16093, elevation_gain_m: 305, pace_min_s_per_km: 298 });
  });

  it("fill the host's edit form in the chosen units", async () => {
    const { client } = await setup();
    const { planId } = await createPlanViaUi(client);
    await chooseUnits(client, "imperial", `/p/${planId}/host`);
    const page = await (await client.get(`/p/${planId}/host`)).text();
    expect(page).toContain('name="distanceKm" value="7.767"');
    expect(page).toContain('name="paceFrom" value="8:51"');
  });

  it("leave link previews metric, as they are the same for everyone (decision I30)", async () => {
    const { client } = await setup();
    const { planId } = await createPlanViaUi(client);
    await chooseUnits(client, "imperial", `/p/${planId}`);
    const page = await (await client.get(`/p/${planId}`)).text();
    const description = /<meta property="og:description" content="([^"]*)"/.exec(page)?.[1] ?? "";
    expect(description).toContain("12.5 km");
  });
});
