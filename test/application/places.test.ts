import { describe, expect, it } from "vite-plus/test";
import {
  describeExactPoint,
  searchPlaces,
  suggestPlaceName,
} from "../../src/application/places.ts";
import { FakeGeocoder } from "../fakes/geocoder.ts";

describe("searchPlaces (spec 3.9)", () => {
  it("returns places for a trimmed query", async () => {
    const geocoder = new FakeGeocoder({
      Flaucher: [{ label: "Flaucher, Munich", lat: 48.11, lng: 11.56 }],
    });
    expect(await searchPlaces({ geocoder }, { query: "  Flaucher ", language: "de" })).toEqual({
      kind: "results",
      places: [{ label: "Flaucher, Munich", lat: 48.11, lng: 11.56 }],
    });
    expect(geocoder.calls).toEqual([{ query: "Flaucher", language: "de" }]);
  });

  it("rejects queries that are too short or too long without calling the service", async () => {
    const geocoder = new FakeGeocoder();
    for (const query of ["", " a ", "x".repeat(101)]) {
      expect(await searchPlaces({ geocoder }, { query, language: "en" })).toEqual({
        kind: "invalid",
      });
    }
    expect(geocoder.calls).toHaveLength(0);
  });

  it("reports an unavailable service", async () => {
    const geocoder = new FakeGeocoder();
    geocoder.failing = true;
    expect(await searchPlaces({ geocoder }, { query: "Park", language: "en" })).toEqual({
      kind: "unavailable",
    });
  });
});

describe("suggestPlaceName (decision D70)", () => {
  const geocoder = () => new FakeGeocoder({}, { "48.11,11.56": "Sendling, München" });

  it("snaps the point to the 0.01 degree grid before the geocoder sees it", async () => {
    const fake = geocoder();
    expect(
      await suggestPlaceName(
        { geocoder: fake },
        { lat: 48.113456, lng: 11.561234, language: "de" },
      ),
    ).toEqual({ kind: "found", label: "Sendling, München" });
    expect(fake.reverseCalls).toEqual([{ lat: 48.11, lng: 11.56, language: "de" }]);
  });

  it("says none when the geocoder names nothing there", async () => {
    const fake = geocoder();
    expect(await suggestPlaceName({ geocoder: fake }, { lat: 1, lng: 2, language: "en" })).toEqual({
      kind: "none",
    });
  });

  it("rejects coordinates that are not finite or out of range, without calling the service", async () => {
    const fake = geocoder();
    for (const [lat, lng] of [
      [91, 0],
      [-90.5, 0],
      [0, 180.5],
      [0, -181],
      [Number.NaN, 0],
      [0, Number.POSITIVE_INFINITY],
    ] as const) {
      expect(await suggestPlaceName({ geocoder: fake }, { lat, lng, language: "en" })).toEqual({
        kind: "invalid",
      });
    }
    expect(fake.reverseCalls).toHaveLength(0);
  });

  it("reports an unavailable service", async () => {
    const fake = geocoder();
    fake.failing = true;
    expect(
      await suggestPlaceName({ geocoder: fake }, { lat: 48.11, lng: 11.56, language: "en" }),
    ).toEqual({ kind: "unavailable" });
  });
});

describe("describeExactPoint (decision D77)", () => {
  const geocoder = () => new FakeGeocoder({}, {}, { "48.11346,11.56123": "Flaucher car park" });

  it("sends the exact point, not the grid cell, and returns the description", async () => {
    const fake = geocoder();
    expect(
      await describeExactPoint(
        { geocoder: fake },
        { lat: 48.11346, lng: 11.56123, language: "de" },
      ),
    ).toEqual({ kind: "found", label: "Flaucher car park" });
    expect(fake.describeCalls).toEqual([{ lat: 48.11346, lng: 11.56123, language: "de" }]);
    expect(fake.reverseCalls).toHaveLength(0);
  });

  it("says none when nothing is named there", async () => {
    expect(
      await describeExactPoint({ geocoder: geocoder() }, { lat: 1, lng: 2, language: "en" }),
    ).toEqual({ kind: "none" });
  });

  it("rejects invalid coordinates without calling the service", async () => {
    const fake = geocoder();
    for (const [lat, lng] of [
      [91, 0],
      [0, 181],
      [Number.NaN, 0],
    ] as const) {
      expect(await describeExactPoint({ geocoder: fake }, { lat, lng, language: "en" })).toEqual({
        kind: "invalid",
      });
    }
    expect(fake.describeCalls).toHaveLength(0);
  });

  it("reports an unavailable service and leaves nothing", async () => {
    const fake = geocoder();
    fake.failing = true;
    expect(
      await describeExactPoint(
        { geocoder: fake },
        { lat: 48.11346, lng: 11.56123, language: "en" },
      ),
    ).toEqual({ kind: "unavailable" });
  });
});
