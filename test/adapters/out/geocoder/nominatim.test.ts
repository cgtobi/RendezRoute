import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  createCachedGeocoder,
  createNominatimGeocoder,
  createThrottle,
} from "../../../../src/adapters/out/geocoder/nominatim.ts";
import { FakeClock } from "../../../fakes/clock.ts";
import { FakeGeocoder } from "../../../fakes/geocoder.ts";
import { FakeOutboundHttp } from "../../../fakes/outbound-http.ts";

const BASE = new URL("https://geo.example.org/nominatim/");
const answer = JSON.stringify([
  { display_name: "Englischer Garten, Munich, Germany", lat: "48.1642", lon: "11.6056" },
  { display_name: "Englischer Garten, Meiningen", lat: "50.5671", lon: "10.4153" },
]);

describe("Nominatim geocoder (spec 3.9)", () => {
  it("queries the configured service and maps results", async () => {
    const http = new FakeOutboundHttp().respond("https://geo.example.org/nominatim/search", {
      body: answer,
    });
    const geocoder = createNominatimGeocoder({
      http,
      baseUrl: BASE,
      throttle: async (run) => run(),
    });
    expect(await geocoder.search("Englischer Garten", { language: "de" })).toEqual([
      { label: "Englischer Garten, Munich, Germany", lat: 48.1642, lng: 11.6056 },
      { label: "Englischer Garten, Meiningen", lat: 50.5671, lng: 10.4153 },
    ]);
    const url = http.requests[0];
    expect(url?.pathname).toBe("/nominatim/search");
    expect(Object.fromEntries(url?.searchParams ?? [])).toEqual({
      q: "Englischer Garten",
      format: "jsonv2",
      limit: "5",
      "accept-language": "de",
    });
  });

  it("fails on errors and unexpected responses, so callers can say the service is unavailable", async () => {
    for (const http of [
      new FakeOutboundHttp().fail("https://geo.example.org/", new Error("timed out")),
      new FakeOutboundHttp().respond("https://geo.example.org/", { status: 503, body: "busy" }),
      new FakeOutboundHttp().respond("https://geo.example.org/", { body: "<html>" }),
      new FakeOutboundHttp().respond("https://geo.example.org/", { body: '[{"display_name": 3}]' }),
    ]) {
      const geocoder = createNominatimGeocoder({
        http,
        baseUrl: BASE,
        throttle: async (run) => run(),
      });
      await expect(geocoder.search("x", { language: "en" })).rejects.toBeInstanceOf(Error);
    }
  });
});

describe("throttle (spec 3.9: max 1 request per second)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("spaces calls at least one interval apart", async () => {
    const throttle = createThrottle({ minIntervalMs: 1000, maxWaitMs: 3000 });
    const started: number[] = [];
    const run = () => throttle(async () => started.push(Date.now()));
    const all = Promise.all([run(), run(), run()]);
    await vi.advanceTimersByTimeAsync(3000);
    await all;
    expect(started[1]! - started[0]!).toBeGreaterThanOrEqual(1000);
    expect(started[2]! - started[1]!).toBeGreaterThanOrEqual(1000);
  });

  it("refuses calls that would wait longer than the limit", async () => {
    const throttle = createThrottle({ minIntervalMs: 1000, maxWaitMs: 1500 });
    const first = throttle(async () => 1);
    const second = throttle(async () => 2);
    // The third call would wait 2 s, so it is refused before any time passes.
    await expect(throttle(async () => 3)).rejects.toThrow(/busy/);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(2);
  });
});

describe("cache (spec 3.10: public data, at most 7 days)", () => {
  it("answers repeated queries from the cache until they expire", async () => {
    const inner = new FakeGeocoder({ park: [{ label: "Park", lat: 1, lng: 2 }] });
    const clock = new FakeClock();
    const cached = createCachedGeocoder(inner, {
      clock,
      ttlMs: 7 * 24 * 3600 * 1000,
      maxEntries: 10,
    });
    await cached.search("park", { language: "en" });
    await cached.search("park", { language: "en" });
    await cached.search("park", { language: "de" });
    expect(inner.calls).toHaveLength(2);
    clock.advance({ days: 7, seconds: 1 });
    await cached.search("park", { language: "en" });
    expect(inner.calls).toHaveLength(3);
  });

  it("keeps at most the configured number of entries", async () => {
    const inner = new FakeGeocoder();
    const cached = createCachedGeocoder(inner, {
      clock: new FakeClock(),
      ttlMs: 1000,
      maxEntries: 2,
    });
    for (const query of ["a", "b", "c", "a"]) await cached.search(query, { language: "en" });
    expect(inner.calls.map((call) => call.query)).toEqual(["a", "b", "c", "a"]);
  });

  it("does not cache failures", async () => {
    const inner = new FakeGeocoder();
    inner.failing = true;
    const cached = createCachedGeocoder(inner, {
      clock: new FakeClock(),
      ttlMs: 1000,
      maxEntries: 2,
    });
    await expect(cached.search("a", { language: "en" })).rejects.toThrow("unavailable");
    inner.failing = false;
    await expect(cached.search("a", { language: "en" })).resolves.toEqual([]);
  });
});
