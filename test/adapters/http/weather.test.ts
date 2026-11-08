// The forecast on the plan page (spec 6 feature 4, 3.9, decision I41).
import { describe, expect, it } from "vite-plus/test";
import { createTestApp } from "../../support/app.ts";
import { TestClient } from "../../support/client.ts";
import { createPlanViaUi } from "../../support/plans.ts";
import { FakeWeather } from "../../fakes/weather.ts";

const section = (html: string) => /<section class="weather">[\s\S]*?<\/section>/.exec(html)?.[0];

describe("the weather forecast on the plan page", () => {
  it("shows the start hour's forecast for the public point, in the viewer's units", async () => {
    const weather = new FakeWeather();
    const asked = () =>
      weather.asked.map(({ point, hour }) => ({ ...point, hour: hour.toISOString() }));
    const { app } = await createTestApp({ weather });
    const { planId } = await createPlanViaUi(new TestClient(app));
    const viewer = new TestClient(app);
    const html = section(await (await viewer.get(`/p/${planId}`)).text()) ?? "";
    expect(html).toContain("Rain · 14 °C · 20% chance of rain · wind 12 km/h");
    expect(html).toContain('href="https://open-meteo.com/"');
    // The public point snapped from the exact start, never the exact start itself.
    expect(asked()).toEqual([{ lat: 48.16, lng: 11.6, hour: "2026-06-07T05:00:00.000Z" }]);

    await viewer.postForm("/units", {
      ...(await viewer.hiddenFields(`/p/${planId}`)),
      units: "imperial",
      returnTo: "/",
    });
    expect(section(await (await viewer.get(`/p/${planId}`)).text())).toContain(
      "Rain · 58 °F · 20% chance of rain · wind 7 mph",
    );
  });

  it("is in the page language", async () => {
    const weather = new FakeWeather();
    const { app } = await createTestApp({ weather });
    const { planId } = await createPlanViaUi(new TestClient(app));
    const html = await (
      await app.request(`/p/${planId}`, { headers: { "accept-language": "de" } })
    ).text();
    expect(section(html)).toContain(
      "Regen · 14 °C · Regenwahrscheinlichkeit 20\u00a0% · Wind 12 km/h",
    );
  });

  it("shows nothing without coordinates, when disabled or when the service fails", async () => {
    const weather = new FakeWeather();
    const asked = () =>
      weather.asked.map(({ point, hour }) => ({ ...point, hour: hour.toISOString() }));
    const { app } = await createTestApp({ weather });
    const { planId } = await createPlanViaUi(new TestClient(app), {
      exactLat: "",
      exactLng: "",
      areaLat: "",
      areaLng: "",
    });
    expect(section(await (await app.request(`/p/${planId}`)).text())).toBeUndefined();
    expect(asked()).toEqual([]);

    const off = await createTestApp({ weather, env: { WEATHER_ENABLED: "false" } });
    const offPlan = await createPlanViaUi(new TestClient(off.app));
    expect(section(await (await off.app.request(`/p/${offPlan.planId}`)).text())).toBeUndefined();

    const broken = await createTestApp({ weather: new FakeWeather(new Error("down")) });
    const brokenPlan = await createPlanViaUi(new TestClient(broken.app));
    const response = await broken.app.request(`/p/${brokenPlan.planId}`);
    expect(response.status).toBe(200);
    expect(section(await response.text())).toBeUndefined();
  });

  it("is not asked for beyond 7 days ahead", async () => {
    const weather = new FakeWeather();
    const asked = () =>
      weather.asked.map(({ point, hour }) => ({ ...point, hour: hour.toISOString() }));
    const { app } = await createTestApp({ weather });
    const { planId } = await createPlanViaUi(new TestClient(app), { date: "2026-06-20" });
    expect(section(await (await app.request(`/p/${planId}`)).text())).toBeUndefined();
    expect(asked()).toEqual([]);
  });
});
