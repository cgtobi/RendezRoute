import { describe, expect, it } from "vite-plus/test";
import { searchPlaces } from "../../src/application/places.ts";
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
