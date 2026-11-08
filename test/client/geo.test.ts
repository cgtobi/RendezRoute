import { describe, expect, it } from "vite-plus/test";
import { escapeHtml, readCoordinate, roundCoordinate, shortLabel } from "../../src/client/geo.ts";

describe("client helpers", () => {
  it("round coordinates to 5 decimals (about a meter)", () => {
    expect(roundCoordinate(48.1234567)).toBe("48.12346");
    expect(roundCoordinate(-0.000004)).toBe("0");
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
