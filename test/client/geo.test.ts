import { describe, expect, it } from "vite-plus/test";
import { publicAreaFrom } from "../../src/domain/geo.ts";
import { NEARBY_GRID_PER_DEGREE as DOMAIN_GRID, onGrid } from "../../src/domain/nearby.ts";
import {
  attributionHtml,
  escapeHtml,
  NEARBY_GRID_PER_DEGREE,
  nearbyCoordinate,
  PUBLIC_GRID_PER_DEGREE,
  publicCircleCenter,
  publicPointOf,
  radiusBounds,
  readCoordinate,
  roundCoordinate,
  shortLabel,
  snapPublicCoordinate,
  zoomForAccuracy,
} from "../../src/client/geo.ts";

describe("client helpers", () => {
  it("round coordinates to 5 decimals (about a meter)", () => {
    expect(roundCoordinate(48.1234567)).toBe("48.12346");
    expect(roundCoordinate(-0.000004)).toBe("0");
  });

  it("put the viewer's place for Nearby on the 0.02° grid, as the server does (D35)", () => {
    expect(NEARBY_GRID_PER_DEGREE).toBe(DOMAIN_GRID);
    for (const value of [48.15321, 11.58911, -0.009, -122.4194, 48.15, 179.99]) {
      expect(nearbyCoordinate(value)).toBe(String(onGrid({ lat: value, lng: 0 }).lat));
    }
    expect(nearbyCoordinate(48.15321)).toBe("48.16");
    expect(nearbyCoordinate(11.58911)).toBe("11.58");
    expect(nearbyCoordinate(-0.009)).toBe("0");
    expect(nearbyCoordinate(-122.4194)).toBe("-122.42");
  });

  it("read coordinates from attributes or inputs, rejecting junk and out-of-range values", () => {
    expect(readCoordinate("48.1", "lat")).toBe(48.1);
    expect(readCoordinate("48,1", "lat")).toBe(48.1);
    expect(readCoordinate("", "lat")).toBeUndefined();
    expect(readCoordinate(undefined, "lng")).toBeUndefined();
    expect(readCoordinate("91", "lat")).toBeUndefined();
    expect(readCoordinate("181", "lng")).toBeUndefined();
    expect(readCoordinate("abc", "lat")).toBeUndefined();
  });

  it("shortens place names to their first part for the area label", () => {
    expect(shortLabel("Englischer Garten, Schwabing, Munich, Bavaria, Germany")).toBe(
      "Englischer Garten",
    );
    expect(shortLabel("  Flaucher  ")).toBe("Flaucher");
  });

  it("escapes text that a library would insert as HTML", () => {
    expect(escapeHtml('© OSM <a href="x">&')).toBe("© OSM &lt;a href=&quot;x&quot;&gt;&amp;");
  });
});

describe("public circle (spec 3.1, mirrors src/domain/geo.ts)", () => {
  // Negative values, zero and its negative neighbours, grid lines, half-way cases, the extremes.
  const TABLE = [
    0, -0.004, 0.004, 0.005, -0.005, 0.006, 48.16321, 48.16, 48.165, 48.1649999, 11.58911,
    -122.4194, -0.0049, 179.999, -179.995, 90, -90, 89.995, 0.015, 0.025, 1.005, 33.335, -33.335,
  ];

  it("snaps every coordinate as the domain's public area does", () => {
    for (const value of TABLE) {
      const domain = publicAreaFrom({ lat: value, lng: -value });
      expect({ value, snapped: snapPublicCoordinate(value) }).toEqual({
        value,
        snapped: domain.lat,
      });
      expect(snapPublicCoordinate(-value)).toBe(domain.lng);
      expect(publicPointOf({ lat: value, lng: -value })).toEqual(domain);
    }
    expect(PUBLIC_GRID_PER_DEGREE).toBe(100);
  });

  it("has no negative zero", () => {
    expect(Object.is(snapPublicCoordinate(-0.004), 0)).toBe(true);
  });

  it("draws the circle around the snapped exact point, else the snapped area point, never the exact point", () => {
    const exact = { lat: 48.16321, lng: 11.58911 };
    const area = { lat: 40, lng: 10 };
    expect(publicCircleCenter(exact, area)).toEqual({ lat: 48.16, lng: 11.59 });
    expect(publicCircleCenter(exact, undefined)).toEqual(publicAreaFrom(exact));
    expect(publicCircleCenter(undefined, { lat: 48.15432, lng: 11.58861 })).toEqual({
      lat: 48.15,
      lng: 11.59,
    });
    expect(publicCircleCenter(undefined, undefined)).toBeUndefined();
    expect(publicCircleCenter(exact, area)).not.toEqual(exact);
  });
});

describe("zoomForAccuracy (decision D62)", () => {
  it("is street level normally and wider for a fix coarser than 2 km", () => {
    expect(zoomForAccuracy(20)).toBe(15);
    expect(zoomForAccuracy(2000)).toBe(15);
    expect(zoomForAccuracy(2000.1)).toBe(13);
    expect(zoomForAccuracy(50_000)).toBe(13);
    expect(zoomForAccuracy(Number.NaN)).toBe(15);
  });
});

describe("attributionHtml", () => {
  it("links OpenStreetMap to its copyright page in the default attribution", () => {
    expect(attributionHtml("© OpenStreetMap contributors")).toBe(
      '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    );
  });

  it("leaves a custom attribution as escaped text", () => {
    expect(attributionHtml("© Example")).toBe("© Example");
    expect(attributionHtml('<img src=x onerror="a()"> OpenStreetMap')).toBe(
      '&lt;img src=x onerror=&quot;a()&quot;&gt; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
    );
  });
});

describe("radiusBounds", () => {
  it("frames the radius around the point, wider in longitude away from the equator", () => {
    const [[south, west], [north, east]] = radiusBounds({ lat: 0, lng: 10 }, 10);
    expect(north - south).toBeCloseTo(2 * (10_000 / 111_320), 6);
    expect(east - west).toBeCloseTo(north - south, 6);
    const [[, w60], [, e60]] = radiusBounds({ lat: 60, lng: 10 }, 10);
    expect(e60 - w60).toBeCloseTo((north - south) * 2, 4);
  });

  it("stays on the globe near the poles", () => {
    const [[south], [north, east]] = radiusBounds({ lat: 89.99, lng: 0 }, 100);
    expect(south).toBeGreaterThan(88);
    expect(north).toBe(90);
    expect(east).toBeLessThanOrEqual(180);
  });
});
