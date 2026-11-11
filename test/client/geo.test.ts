import { describe, expect, it } from "vite-plus/test";
import { NEARBY_GRID_PER_DEGREE as DOMAIN_GRID, onGrid } from "../../src/domain/nearby.ts";
import {
  escapeHtml,
  NEARBY_GRID_PER_DEGREE,
  nearbyCoordinate,
  readCoordinate,
  roundCoordinate,
  shortLabel,
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
