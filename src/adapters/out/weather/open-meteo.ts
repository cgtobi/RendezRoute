// Weather from Open-Meteo (spec 3.9, decision I41): server-side via OutboundHttp, for the public
// point and start hour only. Forecasts are public data, cached in memory.
import type { Clock, Forecast, OutboundHttp, WeatherProvider } from "../../../application/ports.ts";

const HOURLY = ["temperature_2m", "precipitation_probability", "weather_code", "wind_speed_10m"];
/** The plan page waits for the forecast, so a slow service must not hold it up for long. */
const TIMEOUT_MS = 3000;
const MAX_BYTES = 64 * 1024;

/** "2026-06-07T05:00", the hour as Open-Meteo writes it in GMT. */
const hourParam = (hour: Date) => hour.toISOString().slice(0, 16);

export function createOpenMeteoWeather({
  http,
  baseUrl,
}: {
  http: OutboundHttp;
  baseUrl: URL;
}): WeatherProvider {
  const forecastUrl = new URL(
    "v1/forecast",
    baseUrl.href.endsWith("/") ? baseUrl : `${baseUrl.href}/`,
  );
  return {
    async forecast(point, hour) {
      const url = new URL(forecastUrl);
      url.search = new URLSearchParams({
        latitude: String(point.lat),
        longitude: String(point.lng),
        hourly: HOURLY.join(","),
        temperature_unit: "celsius",
        wind_speed_unit: "kmh",
        timezone: "GMT",
        start_hour: hourParam(hour),
        end_hour: hourParam(hour),
      }).toString();
      const response = await http.get(url, {
        headers: { accept: "application/json" },
        maxBytes: MAX_BYTES,
        timeoutMs: TIMEOUT_MS,
      });
      if (response.status !== 200) throw new Error(`Weather service answered ${response.status}.`);
      return parseForecast(JSON.parse(new TextDecoder().decode(response.body)), hourParam(hour));
    },
  };
}

/** The single hour's values; undefined when the answer is for another hour. */
function parseForecast(data: unknown, hour: string): Forecast | undefined {
  const hourly = (data as { hourly?: Record<string, unknown> } | null)?.hourly;
  if (typeof hourly !== "object" || hourly === null) throw new Error("Unexpected weather answer.");
  const valueOf = (name: string): unknown => {
    const values = hourly[name];
    if (!Array.isArray(values)) throw new Error("Unexpected weather answer.");
    return values[0];
  };
  /** A number, or undefined where the weather model has no value (null). */
  const optionalNumber = (name: string): number | undefined => {
    const value = valueOf(name);
    if (value === null) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("Unexpected weather answer.");
    }
    return value;
  };
  const requiredNumber = (name: string): number => {
    const value = optionalNumber(name);
    if (value === undefined) throw new Error("Unexpected weather answer.");
    return value;
  };
  if (valueOf("time") !== hour) return undefined;
  return {
    weatherCode: optionalNumber("weather_code"),
    temperatureC: requiredNumber("temperature_2m"),
    precipitationProbability: optionalNumber("precipitation_probability"),
    windKmh: requiredNumber("wind_speed_10m"),
  };
}

/**
 * In-memory cache per point and hour. Failures answer undefined and are remembered for
 * `failureTtlMs`, so an outage does not slow every plan page; requests for the same key while one
 * is running share it.
 */
export function createCachedWeather(
  inner: WeatherProvider,
  {
    clock,
    ttlMs,
    failureTtlMs,
    maxEntries,
    onError,
  }: {
    clock: Clock;
    ttlMs: number;
    failureTtlMs: number;
    maxEntries: number;
    /** Told about each failed request: at most once per key and `failureTtlMs`. */
    onError?: (error: unknown) => void;
  },
): WeatherProvider {
  const entries = new Map<string, { expires: number; forecast: Forecast | undefined }>();
  const running = new Map<string, Promise<Forecast | undefined>>();

  const fetchAndStore = async (
    key: string,
    point: Parameters<WeatherProvider["forecast"]>[0],
    hour: Date,
  ) => {
    let entry: { expires: number; forecast: Forecast | undefined };
    try {
      const forecast = await inner.forecast(point, hour);
      entry = { expires: clock.now().getTime() + ttlMs, forecast };
    } catch (error) {
      onError?.(error);
      entry = { expires: clock.now().getTime() + failureTtlMs, forecast: undefined };
    }
    entries.set(key, entry);
    if (entries.size > maxEntries) entries.delete(entries.keys().next().value ?? key);
    return entry.forecast;
  };

  return {
    forecast(point, hour) {
      const key = `${point.lat},${point.lng},${hour.toISOString()}`;
      const hit = entries.get(key);
      if (hit !== undefined && hit.expires > clock.now().getTime()) {
        return Promise.resolve(hit.forecast);
      }
      entries.delete(key);
      const pending = running.get(key);
      if (pending !== undefined) return pending;
      const request = fetchAndStore(key, point, hour).finally(() => running.delete(key));
      running.set(key, request);
      return request;
    },
  };
}
