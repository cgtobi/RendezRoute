import { describe, expect, it } from "vite-plus/test";
import {
  parseIso6709,
  parseLinks,
  parseZoneTab,
  renderTable,
  withLinks,
} from "../../scripts/zone-centres.ts";

describe("parseIso6709 (zone.tab coordinates)", () => {
  it("reads degrees and minutes", () => {
    expect(parseIso6709("+5230+01322")).toEqual([52.5, 13.37]);
  });

  it("reads degrees, minutes and seconds, in both hemispheres", () => {
    // 40 deg 42 min 51 s north, 74 deg 0 min 23 s west
    expect(parseIso6709("+404251-0740023")).toEqual([40.71, -74.01]);
  });

  it("reads the southern and the western hemisphere as negative numbers", () => {
    expect(parseIso6709("-3652+17446")).toEqual([-36.87, 174.77]);
    expect(parseIso6709("-3352+15113")).toEqual([-33.87, 151.22]);
    expect(parseIso6709("+3845-00908")).toEqual([38.75, -9.13]);
  });

  it("reads a longitude of three digits and a zero latitude", () => {
    expect(parseIso6709("+0000+00000")).toEqual([0, 0]);
    expect(parseIso6709("-0000-00000")).toEqual([0, 0]);
    expect(parseIso6709("+0100-17900")).toEqual([1.0, -179]);
  });

  it("rejects text that is not a coordinate pair", () => {
    for (const bad of ["", "5230+01322", "+52+013", "+9100+01322", "+5230+18100", "abc"]) {
      expect(() => parseIso6709(bad)).toThrow(/ISO 6709|Out of range/);
    }
  });
});

describe("parseZoneTab and renderTable", () => {
  const text = [
    "# comment",
    "",
    "DE\t+5230+01322\tEurope/Berlin\t",
    "NZ\t-3652+17446\tPacific/Auckland\tmost of New Zealand",
    "AS\t-1416-17042\tPacific/Pago_Pago",
  ].join("\n");

  it("takes the zone and the coordinates, ignoring comments and the rest of the line", () => {
    expect([...parseZoneTab(text)]).toEqual([
      ["Europe/Berlin", [52.5, 13.37]],
      ["Pacific/Auckland", [-36.87, 174.77]],
      ["Pacific/Pago_Pago", [-14.27, -170.7]],
    ]);
  });

  it("rejects a line without coordinates and zone", () => {
    expect(() => parseZoneTab("DE\t+5230+01322")).toThrow(/Bad line/);
  });

  it("renders the table sorted by zone name", () => {
    const out = renderTable(new Map([...parseZoneTab(text)].reverse()));
    expect(out.indexOf("Europe/Berlin")).toBeLessThan(out.indexOf("Pacific/Auckland"));
    expect(out.indexOf("Pacific/Auckland")).toBeLessThan(out.indexOf("Pacific/Pago_Pago"));
    expect(out).toContain('  "Europe/Berlin": [52.5, 13.37],');
    expect(out).toContain("Do not edit by hand");
  });
});

describe("links (old zone names)", () => {
  const zones = parseZoneTab("IN\t+2232+08822\tAsia/Kolkata\nNL\t+5222+00454\tEurope/Amsterdam");
  const links = parseLinks(
    [
      "# version",
      "L Asia/Kolkata Asia/Calcutta",
      "L Asia/Calcutta Asia/Old",
      "L Europe/Brussels Europe/Amsterdam",
      "L Nowhere/Zone Nowhere/Link",
      "Z UTC 0 - UTC",
    ].join("\n"),
  );

  it("reads the L lines only", () => {
    expect(links.get("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(links.size).toBe(4);
  });

  it("gives a link name the place of its target, also through another link", () => {
    const all = withLinks(zones, links);
    expect(all.get("Asia/Calcutta")).toEqual([22.53, 88.37]);
    expect(all.get("Asia/Old")).toEqual([22.53, 88.37]);
  });

  it("keeps the zone's own place, and adds nothing for a target without one", () => {
    const all = withLinks(zones, links);
    expect(all.get("Europe/Amsterdam")).toEqual([52.37, 4.9]);
    expect(all.has("Nowhere/Link")).toBe(false);
  });
});
