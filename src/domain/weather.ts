// Weather for a plan (spec 6 feature 4, 3.9, decision I41): a forecast for the public point at the
// start hour, only for upcoming active plans within the forecast horizon.
import type { GeoPoint } from "./geo.ts";
import type { PlanStatus } from "./plan.ts";

/** Forecasts further ahead are too uncertain to be worth showing. */
export const WEATHER_HORIZON_DAYS = 7;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The point and full hour to ask a forecast for, or undefined when the plan gets none. */
export function forecastHour(
  plan: { startsAt: Date; status: PlanStatus; area: { point: GeoPoint | undefined } },
  now: Date,
): { point: GeoPoint; hour: Date } | undefined {
  const { point } = plan.area;
  const ahead = plan.startsAt.getTime() - now.getTime();
  if (point === undefined || plan.status !== "active") return undefined;
  if (ahead <= 0 || ahead > WEATHER_HORIZON_DAYS * DAY_MS) return undefined;
  return { point, hour: new Date(Math.floor(plan.startsAt.getTime() / HOUR_MS) * HOUR_MS) };
}

export const WEATHER_CONDITIONS = [
  "clear",
  "mainlyClear",
  "partlyCloudy",
  "overcast",
  "fog",
  "drizzle",
  "rain",
  "snow",
  "rainShowers",
  "snowShowers",
  "thunderstorm",
] as const;
export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number];

/** WMO weather interpretation codes, as Open-Meteo reports them, grouped for display. */
export function weatherCondition(code: number): WeatherCondition | undefined {
  if (code === 0) return "clear";
  if (code === 1) return "mainlyClear";
  if (code === 2) return "partlyCloudy";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code >= 61 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "rainShowers";
  if (code === 85 || code === 86) return "snowShowers";
  if (code >= 95 && code <= 99) return "thunderstorm";
  return undefined;
}
