import { describe, expect, it } from "vite-plus/test";
import {
  applyRouteDefaults,
  parseRouteTrim,
  ROUTE_LIMITS,
  ROUTE_TRIM_OPTIONS,
  type Route,
  routeStats,
  trimRoute,
  validateRoute,
} from "../../src/domain/route.ts";
import { sampleInput } from "../fixtures/plans.ts";

const line = (...points: [number, number, number?][]) =>
  points.map(([lat, lng, ele]) => (ele === undefined ? { lat, lng } : { lat, lng, ele }));

describe("routeStats (spec 5 feature 2, decision D10)", () => {
  it("measures distance along each segment, not across gaps between segments", () => {
    const route: Route = { segments: [line([0, 0], [0, 1]), line([10, 10], [10, 10.5])] };
    const { distanceMeters } = routeStats(route);
    expect(distanceMeters).toBeGreaterThan(111_195 + 54_755 - 50);
    expect(distanceMeters).toBeLessThan(111_195 + 54_755 + 50);
  });

  it("counts elevation gain with a 3 m threshold, so GPS noise adds nothing", () => {
    const noisy = line(
      ...Array.from({ length: 50 }, (_, i): [number, number, number] => [
        0,
        i * 0.001,
        100 + (i % 2),
      ]),
    );
    expect(routeStats({ segments: [noisy] }).elevationGainMeters).toBe(0);
    const climb = line([0, 0, 100], [0, 0.001, 110], [0, 0.002, 105], [0, 0.003, 130]);
    expect(routeStats({ segments: [climb] }).elevationGainMeters).toBe(35);
  });

  it("reports no elevation gain without elevation data", () => {
    expect(routeStats({ segments: [line([0, 0], [0, 0.01])] }).elevationGainMeters).toBeUndefined();
  });

  it("starts at the first point", () => {
    expect(routeStats({ segments: [line([48.1, 11.5], [48.2, 11.6])] }).start).toEqual({
      lat: 48.1,
      lng: 11.5,
    });
  });
});

describe("validateRoute (spec 3.8 Uploads)", () => {
  it("rejects empty routes, too many points and invalid coordinates", () => {
    expect(validateRoute({ segments: [] })).toEqual({ ok: false, error: "route_empty" });
    expect(validateRoute({ segments: [line([0, 0])] })).toEqual({
      ok: false,
      error: "route_empty",
    });
    const huge = Array.from({ length: ROUTE_LIMITS.maxPoints + 1 }, () => ({ lat: 0, lng: 0 }));
    expect(validateRoute({ segments: [huge] })).toEqual({
      ok: false,
      error: "route_too_many_points",
    });
    expect(validateRoute({ segments: [line([95, 0], [0, 0])] })).toEqual({
      ok: false,
      error: "route_invalid",
    });
  });

  it("drops single-point segments and rounds coordinates to about a meter", () => {
    const result = validateRoute({
      segments: [line([48.1234567, 11.5432109, 512.345], [48.2, 11.6]), line([1, 1])],
    });
    expect(result).toEqual({
      ok: true,
      value: {
        segments: [
          [
            { lat: 48.12346, lng: 11.54321, ele: 512.3 },
            { lat: 48.2, lng: 11.6 },
          ],
        ],
      },
    });
  });
});

describe("applyRouteDefaults (decision P8, D10)", () => {
  const stats = {
    distanceMeters: 12_345,
    elevationGainMeters: 210,
    start: { lat: 48.16321, lng: 11.60147 },
  };
  const empty = { ...sampleInput, distanceKm: "", elevationGainM: "", exactLat: "", exactLng: "" };

  it("fills empty distance, elevation and exact start coordinates when creating", () => {
    expect(applyRouteDefaults(empty, stats, "fill")).toMatchObject({
      distanceKm: "12.345",
      elevationGainM: "210",
      exactLat: "48.16321",
      exactLng: "11.60147",
    });
  });

  it("keeps values the poster typed when creating", () => {
    const typed = {
      ...empty,
      distanceKm: "10",
      elevationGainM: "100",
      exactLat: "48",
      exactLng: "11",
    };
    expect(applyRouteDefaults(typed, stats, "fill")).toMatchObject({
      distanceKm: "10",
      elevationGainM: "100",
      exactLat: "48",
      exactLng: "11",
    });
  });

  it("sets distance and elevation from a route uploaded on the host page, keeping exact start coordinates", () => {
    const typed = {
      ...empty,
      distanceKm: "10",
      elevationGainM: "100",
      exactLat: "48",
      exactLng: "11",
    };
    expect(applyRouteDefaults(typed, stats, "replace")).toMatchObject({
      distanceKm: "12.345",
      elevationGainM: "210",
      exactLat: "48",
      exactLng: "11",
    });
  });
});

describe("trimRoute (decision D13: hide where a recording started and ended)", () => {
  /** Points 0.001° (about 111 m) apart along a meridian. */
  const north = (from: number, count: number) =>
    line(
      ...Array.from({ length: count }, (_, i): [number, number] => [
        Number((from + i * 0.001).toFixed(3)),
        11,
      ]),
    );
  const lats = (route: Route) => route.segments.map((segment) => segment.map((p) => p.lat));

  it("leaves the route unchanged without trimming", () => {
    const route: Route = { segments: [north(48, 3)] };
    expect(trimRoute(route, 0)).toEqual({ ok: true, value: route });
  });

  it("drops the points near the first and the last point, by straight-line distance", () => {
    const result = trimRoute({ segments: [north(48, 11)] }, 200);
    if (!result.ok) throw new Error(result.error);
    expect(lats(result.value)).toEqual([[48.002, 48.003, 48.004, 48.005, 48.006, 48.007, 48.008]]);
  });

  it("trims both ends of a loop that starts and ends at the same door", () => {
    const out = north(48, 6);
    const back = [...out].reverse().slice(1);
    const result = trimRoute({ segments: [[...out, ...back]] }, 300);
    if (!result.ok) throw new Error(result.error);
    expect(lats(result.value)).toEqual([[48.003, 48.004, 48.005, 48.004, 48.003]]);
  });

  it("trims across segments and drops segments left with fewer than two points", () => {
    // The first segment lies entirely in the start zone; the last keeps a single point.
    const result = trimRoute({ segments: [north(48, 2), north(48.002, 4), north(48.006, 4)] }, 250);
    if (!result.ok) throw new Error(result.error);
    expect(lats(result.value)).toEqual([[48.003, 48.004, 48.005]]);
  });

  it("refuses to trim away the whole route", () => {
    expect(trimRoute({ segments: [north(48, 5)] }, 500)).toEqual({
      ok: false,
      error: "route_trimmed_away",
    });
  });
});

describe("parseRouteTrim (decision D13)", () => {
  it("accepts the offered distances and treats an empty value as no trimming", () => {
    expect(ROUTE_TRIM_OPTIONS).toEqual([0, 200, 500, 1000]);
    expect(parseRouteTrim("")).toEqual({ ok: true, value: 0 });
    expect(parseRouteTrim("500")).toEqual({ ok: true, value: 500 });
  });

  it("rejects anything else", () => {
    for (const value of ["300", "-200", "abc", "200.0"]) {
      expect(parseRouteTrim(value)).toEqual({ ok: false, error: "choice_invalid" });
    }
  });
});
