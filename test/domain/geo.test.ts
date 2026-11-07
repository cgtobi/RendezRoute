import { describe, expect, it } from "vite-plus/test";
import { publicAreaFrom, validateExactStart, validateGeoPoint } from "../../src/domain/geo.ts";

describe("publicAreaFrom (spec 3.1 Public area)", () => {
  it("snaps to the nearest point of a 0.01° grid", () => {
    expect(publicAreaFrom({ lat: 48.15432, lng: 11.58861 })).toEqual({ lat: 48.15, lng: 11.59 });
    expect(publicAreaFrom({ lat: -33.86785, lng: 151.20732 })).toEqual({
      lat: -33.87,
      lng: 151.21,
    });
  });

  it("is never the exact point unless that already lies on the grid", () => {
    const exact = { lat: 48.153, lng: 11.587 };
    expect(publicAreaFrom(exact)).not.toEqual(exact);
  });

  it("keeps the public point within half a grid step of the exact point", () => {
    for (const exact of [
      { lat: 0.004999, lng: -0.004999 },
      { lat: 89.996, lng: 179.996 },
      { lat: -12.345, lng: 67.891 },
    ]) {
      const area = publicAreaFrom(exact);
      expect(Math.abs(area.lat - exact.lat)).toBeLessThanOrEqual(0.005 + 1e-9);
      expect(Math.abs(area.lng - exact.lng)).toBeLessThanOrEqual(0.005 + 1e-9);
    }
  });

  it("produces clean two-decimal values without negative zero", () => {
    const area = publicAreaFrom({ lat: -0.0001, lng: 0.30499 });
    expect(Object.is(area.lat, -0)).toBe(false);
    expect(area).toEqual({ lat: 0, lng: 0.3 });
  });
});

describe("validateGeoPoint", () => {
  it("accepts valid coordinates and rejects out-of-range or non-finite ones", () => {
    expect(validateGeoPoint({ lat: 48.1, lng: 11.5 })).toEqual({
      ok: true,
      value: { lat: 48.1, lng: 11.5 },
    });
    for (const point of [
      { lat: 91, lng: 0 },
      { lat: 0, lng: 180.5 },
      { lat: Number.NaN, lng: 0 },
    ]) {
      expect(validateGeoPoint(point)).toEqual({ ok: false, error: "coordinates_invalid" });
    }
  });
});

describe("validateExactStart (spec 3.1 Exact start, decision D2)", () => {
  it("accepts coordinates, a description, or both", () => {
    expect(validateExactStart({ point: { lat: 48.1, lng: 11.5 } }).ok).toBe(true);
    expect(validateExactStart({ description: "North gate, by the bike racks" })).toEqual({
      ok: true,
      value: { point: undefined, description: "North gate, by the bike racks" },
    });
  });

  it("trims the description and requires at least one part", () => {
    expect(validateExactStart({ description: "   " })).toEqual({
      ok: false,
      error: "exact_start_empty",
    });
    expect(validateExactStart({})).toEqual({ ok: false, error: "exact_start_empty" });
  });

  it("limits the description to 200 characters", () => {
    expect(validateExactStart({ description: "x".repeat(200) }).ok).toBe(true);
    expect(validateExactStart({ description: "x".repeat(201) })).toEqual({
      ok: false,
      error: "exact_start_too_long",
    });
  });
});
