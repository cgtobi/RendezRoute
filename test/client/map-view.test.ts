import { describe, expect, it } from "vite-plus/test";
import {
  browserZone,
  openingView,
  operatorView,
  parseDefaultCenter,
  parseDefaultZoom,
} from "../../src/client/map-view.ts";

const BERLIN = { center: [52.52, 13.405], zoom: 6 };

describe("openingView (decision D63)", () => {
  const operator = { center: [48.1374, 11.5755] as [number, number], zoom: 9 };

  it("opens on a saved point at zoom 15, whatever else is set", () => {
    expect(openingView({ saved: [50, 8], operator, zone: "Asia/Tokyo" })).toEqual({
      center: [50, 8],
      zoom: 15,
    });
    expect(openingView({ saved: [50, 8], operator: undefined, zone: undefined })).toEqual({
      center: [50, 8],
      zoom: 15,
    });
  });

  it("opens on the operator's center with the operator's zoom over the zone", () => {
    expect(openingView({ saved: undefined, operator, zone: "Asia/Tokyo" })).toEqual({
      center: [48.1374, 11.5755],
      zoom: 9,
    });
  });

  it("opens on the browser zone's center at zoom 6 without a saved point or operator center", () => {
    expect(openingView({ saved: undefined, operator: undefined, zone: "Asia/Tokyo" })).toEqual({
      center: [35.65, 139.74],
      zoom: 6,
    });
    expect(openingView({ saved: undefined, operator: undefined, zone: "Europe/Berlin" }).zoom).toBe(
      6,
    );
  });

  it("opens on Berlin at zoom 6 for UTC, an unknown zone or none", () => {
    for (const zone of ["UTC", "Etc/GMT+5", "Mars/Olympus_Mons", "", undefined]) {
      expect(openingView({ saved: undefined, operator: undefined, zone })).toEqual(BERLIN);
    }
  });
});

describe("parseDefaultCenter", () => {
  it("reads lat,lng", () => {
    expect(parseDefaultCenter("48.1374,11.5755")).toEqual([48.1374, 11.5755]);
    expect(parseDefaultCenter("-33.87,-151.2")).toEqual([-33.87, -151.2]);
  });

  it("ignores anything else without a failure", () => {
    for (const bad of [undefined, "", "x", "48.1", "1,2,3", "91,0", "0,181", "48.1;11.5", "a,b"]) {
      expect(parseDefaultCenter(bad)).toBeUndefined();
    }
  });
});

describe("parseDefaultZoom", () => {
  it("reads a whole number from 2 to 12", () => {
    expect(parseDefaultZoom("2")).toBe(2);
    expect(parseDefaultZoom("12")).toBe(12);
  });

  it("ignores everything else", () => {
    for (const bad of [undefined, "", "1", "13", "6.5", "x", "-3"]) {
      expect(parseDefaultZoom(bad)).toBeUndefined();
    }
  });
});

describe("browserZone", () => {
  it("is the browser's zone, as a text", () => {
    expect(typeof browserZone()).toBe("string");
  });

  it("is undefined when Intl fails", () => {
    const original = Intl.DateTimeFormat;
    Intl.DateTimeFormat = (() => {
      throw new Error("no Intl");
    }) as unknown as typeof Intl.DateTimeFormat;
    try {
      expect(browserZone()).toBeUndefined();
    } finally {
      Intl.DateTimeFormat = original;
    }
  });
});

describe("operatorView", () => {
  it("is the center with its zoom", () => {
    expect(operatorView("48.1374,11.5755", "9")).toEqual({ center: [48.1374, 11.5755], zoom: 9 });
  });

  it("opens at zoom 6 when the zoom is missing or bad, and is unset without a valid center", () => {
    expect(operatorView("48.1374,11.5755", undefined)?.zoom).toBe(6);
    expect(operatorView("48.1374,11.5755", "99")?.zoom).toBe(6);
    expect(operatorView(undefined, "9")).toBeUndefined();
    expect(operatorView("nonsense", "9")).toBeUndefined();
  });
});
