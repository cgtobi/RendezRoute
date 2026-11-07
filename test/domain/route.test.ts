import { describe, expect, it } from "vite-plus/test";
import {
  applyRouteDefaults,
  ROUTE_LIMITS,
  type Route,
  routeStats,
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
