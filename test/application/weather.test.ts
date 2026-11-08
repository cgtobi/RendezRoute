import { describe, expect, it } from "vite-plus/test";
import { planWeather } from "../../src/application/weather.ts";
import { FakeClock } from "../fakes/clock.ts";
import { FakeWeather } from "../fakes/weather.ts";

const clock = new FakeClock(new Date("2026-06-01T08:00:00Z"));
const plan = {
  startsAt: new Date("2026-06-07T05:30:00Z"),
  status: "active" as const,
  area: { point: { lat: 48.16, lng: 11.6 } },
};

describe("planWeather (spec 6 feature 4)", () => {
  it("asks for the start hour at the public point and names the condition", async () => {
    const weather = new FakeWeather();
    expect(await planWeather({ weather, clock }, plan)).toEqual({
      condition: "rain",
      temperatureC: 14.2,
      precipitationProbability: 20,
      windKmh: 11.8,
    });
    expect(weather.asked).toEqual([
      { point: { lat: 48.16, lng: 11.6 }, hour: new Date("2026-06-07T05:00:00Z") },
    ]);
  });

  it("is nothing when weather is off, the plan gets none, or the service fails", async () => {
    expect(await planWeather({ weather: undefined, clock }, plan)).toBeUndefined();
    const weather = new FakeWeather();
    expect(
      await planWeather({ weather, clock }, { ...plan, area: { point: undefined } }),
    ).toBeUndefined();
    expect(weather.asked).toEqual([]);
    const failing = new FakeWeather(new Error("down"));
    expect(await planWeather({ weather: failing, clock }, plan)).toBeUndefined();
  });

  it("has no condition for an unknown or missing weather code", async () => {
    for (const weatherCode of [42, undefined]) {
      const weather = new FakeWeather({ ...FakeWeather.rain, weatherCode });
      const view = await planWeather({ weather, clock }, plan);
      expect(view).toMatchObject({ condition: undefined, temperatureC: 14.2 });
    }
  });
});
