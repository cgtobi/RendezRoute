// The forecast on the plan page (spec 6 feature 4, 3.9, decision I41). Weather is a nicety: any
// failure shows nothing rather than an error.
import type { GeoPoint } from "../domain/geo.ts";
import type { PlanStatus } from "../domain/plan.ts";
import { forecastHour, type WeatherCondition, weatherCondition } from "../domain/weather.ts";
import type { Clock, WeatherProvider } from "./ports.ts";

export interface WeatherView {
  /** Undefined for a weather code without a known meaning. */
  condition: WeatherCondition | undefined;
  temperatureC: number;
  precipitationProbability: number | undefined;
  windKmh: number;
}

export async function planWeather(
  deps: { weather: WeatherProvider | undefined; clock: Clock },
  plan: { startsAt: Date; status: PlanStatus; area: { point: GeoPoint | undefined } },
): Promise<WeatherView | undefined> {
  if (deps.weather === undefined) return undefined;
  const request = forecastHour(plan, deps.clock.now());
  if (request === undefined) return undefined;
  try {
    const forecast = await deps.weather.forecast(request.point, request.hour);
    if (forecast === undefined) return undefined;
    return {
      condition:
        forecast.weatherCode === undefined ? undefined : weatherCondition(forecast.weatherCode),
      temperatureC: forecast.temperatureC,
      precipitationProbability: forecast.precipitationProbability,
      windKmh: forecast.windKmh,
    };
  } catch {
    return undefined;
  }
}
