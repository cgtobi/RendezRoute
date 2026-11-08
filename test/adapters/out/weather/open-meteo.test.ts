import { describe, expect, it } from "vite-plus/test";
import {
  createCachedWeather,
  createOpenMeteoWeather,
} from "../../../../src/adapters/out/weather/open-meteo.ts";
import { FakeClock } from "../../../fakes/clock.ts";
import { FakeOutboundHttp } from "../../../fakes/outbound-http.ts";
import { FakeWeather } from "../../../fakes/weather.ts";

const point = { lat: 48.16, lng: 11.6 };
const hour = new Date("2026-06-07T05:00:00Z");
const answer = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    hourly: {
      time: ["2026-06-07T05:00"],
      temperature_2m: [14.2],
      precipitation_probability: [20],
      weather_code: [61],
      wind_speed_10m: [11.8],
      ...overrides,
    },
  });

describe("Open-Meteo weather (spec 3.9)", () => {
  it("asks for the hour at the public point and reads the forecast", async () => {
    const http = new FakeOutboundHttp().respond("https://api.open-meteo.com/v1/forecast", {
      body: answer(),
    });
    const weather = createOpenMeteoWeather({
      http,
      baseUrl: new URL("https://api.open-meteo.com"),
    });
    expect(await weather.forecast(point, hour)).toEqual({
      weatherCode: 61,
      temperatureC: 14.2,
      precipitationProbability: 20,
      windKmh: 11.8,
    });
    const url = http.requests[0];
    expect(url?.pathname).toBe("/v1/forecast");
    expect(Object.fromEntries(url?.searchParams ?? [])).toEqual({
      latitude: "48.16",
      longitude: "11.6",
      hourly: "temperature_2m,precipitation_probability,weather_code,wind_speed_10m",
      temperature_unit: "celsius",
      wind_speed_unit: "kmh",
      timezone: "GMT",
      start_hour: "2026-06-07T05:00",
      end_hour: "2026-06-07T05:00",
    });
  });

  it("keeps a missing chance of rain or weather code missing, and has no forecast for another hour", async () => {
    const http = new FakeOutboundHttp().respond("https://api.open-meteo.com/", {
      body: answer({ precipitation_probability: [null], weather_code: [null] }),
    });
    const weather = createOpenMeteoWeather({
      http,
      baseUrl: new URL("https://api.open-meteo.com"),
    });
    expect(await weather.forecast(point, hour)).toEqual({
      weatherCode: undefined,
      temperatureC: 14.2,
      precipitationProbability: undefined,
      windKmh: 11.8,
    });
    http.respond("https://api.open-meteo.com/", { body: answer({ time: ["2026-06-07T06:00"] }) });
    expect(await weather.forecast(point, hour)).toBeUndefined();
  });

  it("fails on errors and unexpected answers", async () => {
    const http = new FakeOutboundHttp().respond("https://api.open-meteo.com/", { status: 500 });
    const weather = createOpenMeteoWeather({
      http,
      baseUrl: new URL("https://api.open-meteo.com"),
    });
    await expect(weather.forecast(point, hour)).rejects.toThrow("Weather service answered 500.");
    http.respond("https://api.open-meteo.com/", { body: answer({ temperature_2m: ["warm"] }) });
    await expect(weather.forecast(point, hour)).rejects.toThrow("Unexpected weather answer.");
  });
});

describe("the weather cache (decision I41)", () => {
  const newClock = () => new FakeClock(new Date("2026-06-01T08:00:00Z"));
  const options = (
    clock: FakeClock,
    extra: Partial<Parameters<typeof createCachedWeather>[1]> = {},
  ) => ({
    clock,
    ttlMs: 60 * 60 * 1000,
    failureTtlMs: 10 * 60 * 1000,
    maxEntries: 10,
    ...extra,
  });

  it("keeps forecasts for ttlMs per point and hour", async () => {
    const clock = newClock();
    const inner = new FakeWeather();
    const cached = createCachedWeather(inner, options(clock));
    await cached.forecast(point, hour);
    await cached.forecast(point, hour);
    expect(inner.asked).toHaveLength(1);
    await cached.forecast({ lat: 48.17, lng: 11.6 }, hour);
    expect(inner.asked).toHaveLength(2);
    clock.advance({ minutes: 60 });
    await cached.forecast(point, hour);
    expect(inner.asked).toHaveLength(3);
  });

  it("remembers failures for failureTtlMs and reports each failed request", async () => {
    const clock = newClock();
    const inner = new FakeWeather(new Error("down"));
    const errors: unknown[] = [];
    const cached = createCachedWeather(
      inner,
      options(clock, { onError: (error) => errors.push(error) }),
    );
    expect(await cached.forecast(point, hour)).toBeUndefined();
    expect(await cached.forecast(point, hour)).toBeUndefined();
    expect(inner.asked).toHaveLength(1);
    expect(errors).toHaveLength(1);
    clock.advance({ minutes: 10 });
    await cached.forecast(point, hour);
    expect(inner.asked).toHaveLength(2);
    expect(errors).toHaveLength(2);
  });

  it("lets requests for the same point and hour share one running request", async () => {
    const inner = new FakeWeather();
    const cached = createCachedWeather(inner, options(newClock()));
    const answers = await Promise.all([cached.forecast(point, hour), cached.forecast(point, hour)]);
    expect(inner.asked).toHaveLength(1);
    expect(answers[0]).toEqual(answers[1]);
  });

  it("holds at most maxEntries", async () => {
    const inner = new FakeWeather();
    const cached = createCachedWeather(inner, options(newClock(), { maxEntries: 1 }));
    await cached.forecast(point, hour);
    await cached.forecast({ lat: 1, lng: 1 }, hour);
    await cached.forecast(point, hour);
    expect(inner.asked).toHaveLength(3);
  });
});
