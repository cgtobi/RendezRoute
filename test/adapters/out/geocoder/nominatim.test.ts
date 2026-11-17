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

describe("Nominatim reverse lookup (decision D70)", () => {
  const reverseBody = (address: Record<string, string> | undefined, extra = {}) =>
    JSON.stringify({
      place_id: 1,
      display_name: "12, Some Road, Sendling, München, Bayern, Deutschland",
      name: "Some Cafe",
      ...(address === undefined ? {} : { address }),
      ...extra,
    });

  async function lookup(body: string, language = "de") {
    const http = new FakeOutboundHttp().respond("https://geo.example.org/nominatim/reverse", {
      body,
    });
    const geocoder = createNominatimGeocoder({
      http,
      baseUrl: BASE,
      throttle: async (run) => run(),
    });
    return { http, label: await geocoder.reverse({ lat: 48.11, lng: 11.56 }, { language }) };
  }

  it("asks for a neighbourhood-level answer with the address parts, and sends only the point", async () => {
    const { http } = await lookup(reverseBody({ suburb: "Sendling", city: "München" }));
    const url = http.requests[0];
    expect(url?.pathname).toBe("/nominatim/reverse");
    expect(Object.fromEntries(url?.searchParams ?? [])).toEqual({
      lat: "48.11",
      lon: "11.56",
      format: "jsonv2",
      zoom: "14",
      addressdetails: "1",
      "accept-language": "de",
    });
  });

  it("names the district and the city", async () => {
    expect((await lookup(reverseBody({ suburb: "Sendling", city: "München" }))).label).toBe(
      "Sendling, München",
    );
    expect(
      (await lookup(reverseBody({ city_district: "Bezirk 6", city: "München", suburb: "" }))).label,
    ).toBe("Bezirk 6, München");
    expect((await lookup(reverseBody({ quarter: "Altstadt", town: "Bamberg" }))).label).toBe(
      "Altstadt, Bamberg",
    );
    expect(
      (await lookup(reverseBody({ borough: "Mitte", quarter: "Q", city: "Berlin" }))).label,
    ).toBe("Mitte, Berlin");
  });

  it("does not use a neighbourhood, which can be a single housing estate", async () => {
    expect(
      (await lookup(reverseBody({ neighbourhood: "Siedlung X", city: "München" }))).label,
    ).toBe("München");
    expect((await lookup(reverseBody({ neighbourhood: "Siedlung X" }))).label).toBeUndefined();
  });

  it("cleans the name: no control or bidi characters, collapsed spaces", async () => {
    const dirty = "Send\tling\u0085  \u202Eevil\u202C";
    const { label } = await lookup(reverseBody({ suburb: dirty, city: " Mün\nchen " }));
    expect(label).toBe("Send ling evil, Mün chen");
    expect((await lookup(reverseBody({ city: "\t\u202E \u0085" }))).label).toBeUndefined();
  });

  it("cuts a long name on a code point without a dangling separator", async () => {
    const district = "d".repeat(99);
    const cut = (await lookup(reverseBody({ suburb: district, city: "München" }))).label;
    expect(cut).toBe(district);
    const emoji = (await lookup(reverseBody({ city: "😀".repeat(150) }))).label;
    expect(Array.from(emoji ?? "")).toHaveLength(100);
    const spaced = (await lookup(reverseBody({ suburb: "d".repeat(98), city: "x y" }))).label;
    expect(spaced).toBe("d".repeat(98));
  });

  it("names only the city, town, village or municipality when there is no district", async () => {
    expect((await lookup(reverseBody({ city: "München" }))).label).toBe("München");
    expect((await lookup(reverseBody({ village: "Oberammergau", state: "Bayern" }))).label).toBe(
      "Oberammergau",
    );
    expect((await lookup(reverseBody({ municipality: "Gemeinde X" }))).label).toBe("Gemeinde X");
  });

  it("does not repeat a district that is named like the city", async () => {
    expect((await lookup(reverseBody({ suburb: "München", city: "München" }))).label).toBe(
      "München",
    );
  });

  it("never uses the road, house number, building names or the display name", async () => {
    const street = await lookup(
      reverseBody({ road: "Some Road", house_number: "12", postcode: "81369", state: "Bayern" }),
    );
    expect(street.label).toBeUndefined();
    const amenity = await lookup(reverseBody({ amenity: "Some Cafe", building: "B", shop: "S" }));
    expect(amenity.label).toBeUndefined();
    const full = (
      await lookup(
        reverseBody({
          road: "Some Road",
          house_number: "12",
          amenity: "Some Cafe",
          suburb: "Sendling",
          city: "München",
        }),
      )
    ).label;
    expect(full).toBe("Sendling, München");
    expect(full).not.toMatch(/Road|12|Cafe|Bayern/);
  });

  it("finds nothing for an error answer or an answer without an address", async () => {
    expect((await lookup(JSON.stringify({ error: "Unable to geocode" }))).label).toBeUndefined();
    expect(
      (await lookup(reverseBody({ city: "München" }, { error: "Unable to geocode" }))).label,
    ).toBeUndefined();
    expect((await lookup(reverseBody(undefined))).label).toBeUndefined();
  });

  it("limits the name to the length of the meeting-area field", async () => {
    const { label } = await lookup(reverseBody({ city: "x".repeat(300) }));
    expect(Array.from(label ?? "")).toHaveLength(100);
  });

  it("fails on errors and unexpected responses, so callers can say the service is unavailable", async () => {
    for (const http of [
      new FakeOutboundHttp().fail("https://geo.example.org/", new Error("timed out")),
      new FakeOutboundHttp().respond("https://geo.example.org/", { status: 503, body: "busy" }),
      new FakeOutboundHttp().respond("https://geo.example.org/", { body: "<html>" }),
      new FakeOutboundHttp().respond("https://geo.example.org/", { body: "[]" }),
      new FakeOutboundHttp().respond("https://geo.example.org/", { body: "null" }),
      new FakeOutboundHttp().respond("https://geo.example.org/", {
        body: '{"address": "Sendling"}',
      }),
    ]) {
      const geocoder = createNominatimGeocoder({
        http,
        baseUrl: BASE,
        throttle: async (run) => run(),
      });
      await expect(
        geocoder.reverse({ lat: 48.11, lng: 11.56 }, { language: "en" }),
      ).rejects.toBeInstanceOf(Error);
    }
  });

  it("goes through the same throttle as the search", async () => {
    const http = new FakeOutboundHttp().respond("https://geo.example.org/", { body: "{}" });
    let throttled = 0;
    const geocoder = createNominatimGeocoder({
      http,
      baseUrl: BASE,
      throttle: async (run) => {
        throttled += 1;
        return run();
      },
    });
    await geocoder.reverse({ lat: 1, lng: 2 }, { language: "en" });
    expect(throttled).toBe(1);
  });
});

describe("Nominatim description of the exact point (decision D77)", () => {
  const body = (extra: Record<string, unknown>) =>
    JSON.stringify({ display_name: "12, Some Road, Sendling, München, Deutschland", ...extra });

  async function describeAt(text: string, language = "en") {
    const http = new FakeOutboundHttp().respond("https://geo.example.org/nominatim/reverse", {
      body: text,
    });
    const geocoder = createNominatimGeocoder({
      http,
      baseUrl: BASE,
      throttle: async (run) => run(),
    });
    return {
      http,
      label: await geocoder.describe({ lat: 48.11346, lng: 11.56123 }, { language }),
    };
  }

  it("asks at street level with the exact point and sends nothing else", async () => {
    const { http } = await describeAt(body({ address: { road: "Some Road" } }));
    const url = http.requests[0];
    expect(url?.pathname).toBe("/nominatim/reverse");
    expect(Object.fromEntries(url?.searchParams ?? [])).toEqual({
      lat: "48.11346",
      lon: "11.56123",
      format: "jsonv2",
      zoom: "18",
      addressdetails: "1",
      "accept-language": "en",
    });
  });

  it("names a place and the road it is on, never the house number or the full address", async () => {
    const { label } = await describeAt(
      body({
        name: "Flaucher car park",
        address: { road: "Isarauen", house_number: "12", suburb: "Sendling", postcode: "81369" },
      }),
    );
    expect(label).toBe("Flaucher car park, Isarauen");
    expect(label).not.toMatch(/12|Sendling|81369|Deutschland/);
  });

  it("uses the road alone, a way type other than road, or the name alone", async () => {
    expect(
      (await describeAt(body({ address: { road: "Some Road", house_number: "3" } }))).label,
    ).toBe("Some Road");
    expect((await describeAt(body({ address: { footway: "Isarweg" } }))).label).toBe("Isarweg");
    expect((await describeAt(body({ name: "Kiosk", address: { city: "München" } }))).label).toBe(
      "Kiosk",
    );
    expect(
      (await describeAt(body({ name: "Some Road", address: { road: "Some Road" } }))).label,
    ).toBe("Some Road");
  });

  it("answers undefined for nothing found, or only a house number or locality", async () => {
    expect((await describeAt(body({ error: "Unable to geocode" }))).label).toBeUndefined();
    expect(
      (await describeAt(body({ address: { house_number: "3", city: "München" } }))).label,
    ).toBeUndefined();
    expect((await describeAt(body({ name: "  " }))).label).toBeUndefined();
  });

  it("cleans upstream text and cuts it to the description field's length", async () => {
    const dirty = await describeAt(body({ address: { road: " Isar\nweg\u202E " } }));
    expect(dirty.label).toBe("Isar weg");
    const long = await describeAt(body({ address: { road: "x".repeat(300) } }));
    expect(Array.from(long.label ?? "")).toHaveLength(200);
  });

  it("fails on errors and unexpected responses, so nothing is filled in", async () => {
    for (const http of [
      new FakeOutboundHttp().fail("https://geo.example.org/", new Error("timed out")),
      new FakeOutboundHttp().respond("https://geo.example.org/", { status: 503, body: "busy" }),
      new FakeOutboundHttp().respond("https://geo.example.org/", { body: "<html>" }),
      new FakeOutboundHttp().respond("https://geo.example.org/", { body: "[]" }),
    ]) {
      const geocoder = createNominatimGeocoder({
        http,
        baseUrl: BASE,
        throttle: async (run) => run(),
      });
      await expect(
        geocoder.describe({ lat: 48.11, lng: 11.56 }, { language: "en" }),
      ).rejects.toBeInstanceOf(Error);
    }
  });

  it("goes through the same throttle as the other lookups", async () => {
    const http = new FakeOutboundHttp().respond("https://geo.example.org/", { body: "{}" });
    let throttled = 0;
    const geocoder = createNominatimGeocoder({
      http,
      baseUrl: BASE,
      throttle: async (run) => {
        throttled += 1;
        return run();
      },
    });
    await geocoder.describe({ lat: 1, lng: 2 }, { language: "en" });
    expect(throttled).toBe(1);
  });

  it("is never cached: every lookup of an exact point reaches the service", async () => {
    const inner = new FakeGeocoder({}, {}, { "48.11346,11.56123": "Flaucher car park" });
    const cached = createCachedGeocoder(inner, {
      clock: new FakeClock(),
      ttlMs: 7 * 24 * 3600 * 1000,
      maxEntries: 10,
    });
    const point = { lat: 48.11346, lng: 11.56123 };
    expect(await cached.describe(point, { language: "en" })).toBe("Flaucher car park");
    expect(await cached.describe(point, { language: "en" })).toBe("Flaucher car park");
    expect(inner.describeCalls).toEqual([
      { ...point, language: "en" },
      { ...point, language: "en" },
    ]);
    // Nothing of it is shared with the cell's cached name.
    await cached.reverse({ lat: 48.11, lng: 11.56 }, { language: "en" });
    await cached.describe(point, { language: "en" });
    expect(inner.describeCalls).toHaveLength(3);
  });

  it("does not turn a failure into a kept answer", async () => {
    const inner = new FakeGeocoder();
    inner.failing = true;
    const cached = createCachedGeocoder(inner, {
      clock: new FakeClock(),
      ttlMs: 1000,
      maxEntries: 2,
    });
    await expect(cached.describe({ lat: 1, lng: 2 }, { language: "en" })).rejects.toThrow(
      "unavailable",
    );
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

  it("answers reverse lookups from the cache by language and 0.01 degree cell", async () => {
    const inner = new FakeGeocoder({}, { "48.11,11.56": "Sendling, München" });
    const cached = createCachedGeocoder(inner, {
      clock: new FakeClock(),
      ttlMs: 1000,
      maxEntries: 10,
    });
    const en = { language: "en" };
    expect(await cached.reverse({ lat: 48.11, lng: 11.56 }, en)).toBe("Sendling, München");
    expect(await cached.reverse({ lat: 48.114, lng: 11.556 }, en)).toBe("Sendling, München");
    expect(inner.reverseCalls).toHaveLength(1);
    await cached.reverse({ lat: 48.11, lng: 11.56 }, { language: "de" });
    await cached.reverse({ lat: 48.1204, lng: 11.56 }, en);
    expect(inner.reverseCalls).toHaveLength(3);
    // The wrapped geocoder only ever sees the grid cell, whatever the caller passed.
    expect(inner.reverseCalls[2]).toEqual({ lat: 48.12, lng: 11.56, language: "en" });
  });

  it("caches a not-found cell for the same time, but not a failure", async () => {
    const inner = new FakeGeocoder();
    const clock = new FakeClock();
    const cached = createCachedGeocoder(inner, { clock, ttlMs: 1000, maxEntries: 10 });
    const point = { lat: 1, lng: 2 };
    expect(await cached.reverse(point, { language: "en" })).toBeUndefined();
    expect(await cached.reverse(point, { language: "en" })).toBeUndefined();
    expect(inner.reverseCalls).toHaveLength(1);
    clock.advance({ seconds: 2 });
    await cached.reverse(point, { language: "en" });
    expect(inner.reverseCalls).toHaveLength(2);
    inner.failing = true;
    const other = { lat: 3, lng: 4 };
    await expect(cached.reverse(other, { language: "en" })).rejects.toThrow("unavailable");
    inner.failing = false;
    await expect(cached.reverse(other, { language: "en" })).resolves.toBeUndefined();
    expect(inner.reverseCalls).toHaveLength(4);
  });

  it("keeps search and reverse entries apart", async () => {
    const inner = new FakeGeocoder();
    const cached = createCachedGeocoder(inner, {
      clock: new FakeClock(),
      ttlMs: 1000,
      maxEntries: 10,
    });
    await cached.search("48.11,11.56", { language: "en" });
    await cached.reverse({ lat: 48.11, lng: 11.56 }, { language: "en" });
    expect(inner.calls).toHaveLength(1);
    expect(inner.reverseCalls).toHaveLength(1);
  });
});
