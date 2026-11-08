import { describe, expect, it } from "vite-plus/test";
import { forecastHour, weatherCondition } from "../../src/domain/weather.ts";

const now = new Date("2026-06-01T08:00:00Z");
const plan = (startsAt: string, overrides: { point?: undefined; status?: "cancelled" } = {}) => ({
  startsAt: new Date(startsAt),
  status: "active" as "active" | "cancelled",
  area: { point: { lat: 48.16, lng: 11.6 } as { lat: number; lng: number } | undefined },
  ...("point" in overrides ? { area: { point: undefined } } : {}),
  ...(overrides.status === undefined ? {} : { status: overrides.status }),
});

describe("forecastHour (spec 6 feature 4, decision I41)", () => {
  it("is the full hour of the start at the public point", () => {
    expect(forecastHour(plan("2026-06-07T05:30:00Z"), now)).toEqual({
      point: { lat: 48.16, lng: 11.6 },
      hour: new Date("2026-06-07T05:00:00Z"),
    });
  });

  it("is only within 7 days, before the start, with coordinates and for active plans", () => {
    expect(forecastHour(plan("2026-06-08T08:00:00Z"), now)).toBeDefined();
    expect(forecastHour(plan("2026-06-08T08:00:01Z"), now)).toBeUndefined();
    expect(forecastHour(plan("2026-06-01T08:00:00Z"), now)).toBeUndefined();
    expect(forecastHour(plan("2026-06-07T05:30:00Z", { point: undefined }), now)).toBeUndefined();
    expect(
      forecastHour(plan("2026-06-07T05:30:00Z", { status: "cancelled" }), now),
    ).toBeUndefined();
  });
});

describe("weatherCondition (WMO weather codes)", () => {
  it("groups the codes Open-Meteo reports", () => {
    expect(
      [0, 1, 2, 3, 45, 48, 51, 57, 61, 67, 71, 77, 80, 82, 85, 86, 95, 99].map(weatherCondition),
    ).toEqual([
      "clear",
      "mainlyClear",
      "partlyCloudy",
      "overcast",
      "fog",
      "fog",
      "drizzle",
      "drizzle",
      "rain",
      "rain",
      "snow",
      "snow",
      "rainShowers",
      "rainShowers",
      "snowShowers",
      "snowShowers",
      "thunderstorm",
      "thunderstorm",
    ]);
    expect(weatherCondition(42)).toBeUndefined();
  });
});
