import { describe, expect, it } from "vite-plus/test";
import {
  cutToMeetingPoint,
  routeToKeep,
  applyRouteDefaults,
  parseRouteTrim,
  ROUTE_LIMITS,
  ROUTE_TRIM_OPTIONS,
  type Route,
  type RoutePoint,
  routeStats,
  trimRoute,
  validateRoute,
} from "../../src/domain/route.ts";
import { distanceMeters } from "../../src/domain/geo.ts";
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
  const BOTH = { start: true, end: true };
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
    expect(trimRoute(route, 0, BOTH)).toEqual({ ok: true, value: route });
  });

  it("drops the points near the first and the last point, by straight-line distance", () => {
    const result = trimRoute({ segments: [north(48, 11)] }, 200, BOTH);
    if (!result.ok) throw new Error(result.error);
    expect(lats(result.value)).toEqual([[48.002, 48.003, 48.004, 48.005, 48.006, 48.007, 48.008]]);
  });

  it("trims both ends of a loop that starts and ends at the same door", () => {
    const out = north(48, 6);
    const back = [...out].reverse().slice(1);
    const result = trimRoute({ segments: [[...out, ...back]] }, 300, BOTH);
    if (!result.ok) throw new Error(result.error);
    expect(lats(result.value)).toEqual([[48.003, 48.004, 48.005, 48.004, 48.003]]);
  });

  it("trims across segments and drops segments left with fewer than two points", () => {
    // The first segment lies entirely in the start zone; the last keeps a single point.
    const result = trimRoute(
      { segments: [north(48, 2), north(48.002, 4), north(48.006, 4)] },
      250,
      BOTH,
    );
    if (!result.ok) throw new Error(result.error);
    expect(lats(result.value)).toEqual([[48.003, 48.004, 48.005]]);
  });

  it("refuses to trim away the whole route", () => {
    expect(trimRoute({ segments: [north(48, 5)] }, 500, BOTH)).toEqual({
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

/** Points every ~100 m along a meridian, from one latitude to another (0.0009° ≈ 100 m). */
const leg = (fromLat: number, toLat: number, lng: number): RoutePoint[] => {
  const steps = Math.round(Math.abs(toLat - fromLat) / 0.0009);
  return Array.from({ length: steps + 1 }, (_, i) => ({
    lat: Number((fromLat + ((toLat - fromLat) * i) / steps).toFixed(5)),
    lng,
  }));
};
// Home at 48.100; the group meets about 1.1 km north, at 48.110.
const home = { lat: 48.1, lng: 11 };
const meeting = { lat: 48.11, lng: 11.0005 };
const oneWay: Route = { segments: [leg(48.1, 48.14, 11)] };
/** Out on one street, back on the next (about 75 m apart), home again. */
const loop: Route = { segments: [[...leg(48.1, 48.14, 11), ...leg(48.14, 48.1, 11.001)]] };
const points = (route: Route) => route.segments.flat();
const nearHome = (route: Route, meters: number) =>
  points(route).some((point) => distanceMeters(home, point) <= meters);

describe("cutToMeetingPoint (decision D40: a home in the route)", () => {
  it("cuts a loop to start and end at the meeting point", () => {
    const cut = cutToMeetingPoint(loop, meeting);
    if (!cut.ok) throw new Error(cut.error);
    expect(cut.value.cut).toEqual({ start: true, end: true });
    expect(nearHome(cut.value.route, 1000)).toBe(false);
    for (const end of [points(cut.value.route)[0], points(cut.value.route).at(-1)]) {
      expect(distanceMeters(meeting, end!)).toBeLessThanOrEqual(100);
    }
    // The ride itself stays whole.
    expect(points(cut.value.route).some((point) => point.lat === 48.14)).toBe(true);
  });

  it("cuts only the start of a one-way route", () => {
    const cut = cutToMeetingPoint(oneWay, meeting);
    if (!cut.ok) throw new Error(cut.error);
    expect(cut.value.cut).toEqual({ start: true, end: false });
    expect(points(cut.value.route).at(-1)).toEqual({ lat: 48.14, lng: 11 });
  });

  it("keeps a short ride after a long way from home (decision D40)", () => {
    // 15 km from home to the meeting point, then 10 km of ride: the meeting point is past halfway.
    const way = leg(48.1, 48.235, 11);
    const ride = leg(48.235, 48.325, 11.001);
    const cut = cutToMeetingPoint({ segments: [[...way, ...ride]] }, way.at(-1)!);
    if (!cut.ok) throw new Error(cut.error);
    expect(cut.value.cut).toEqual({ start: true, end: false });
    expect(points(cut.value.route)[0]).toEqual(way.at(-1));
    expect(points(cut.value.route)).toHaveLength(ride.length + 1);
    expect(points(cut.value.route).at(-1)).toEqual(ride.at(-1));
  });

  it("keeps everything between the first and the last pass, laps through the meeting point too", () => {
    // Home, to the meeting point, a lap and a figure-eight through it, and back to it, then home.
    const m = { lat: 48.11, lng: 11 };
    const lap = leg(48.11, 48.13, 11.002).concat(leg(48.13, 48.11, 11.004));
    const route: Route = {
      segments: [
        [
          ...leg(48.1, 48.11, 11),
          ...lap,
          { lat: 48.11, lng: 11.0001 },
          ...leg(48.11, 48.12, 11.0003),
          ...leg(48.12, 48.1, 11.003),
        ],
      ],
    };
    const cut = cutToMeetingPoint(route, m);
    if (!cut.ok) throw new Error(cut.error);
    expect(cut.value.cut).toEqual({ start: true, end: true });
    const kept = points(cut.value.route);
    // The far point of the lap is kept, and the route runs from near the meeting point to near it.
    expect(kept.some((point) => point.lat === 48.13)).toBe(true);
    expect(kept.some((point) => point.lat === 48.12)).toBe(true);
    expect(distanceMeters(m, kept[0]!)).toBeLessThanOrEqual(10);
    expect(distanceMeters(m, kept.at(-1)!)).toBeLessThanOrEqual(150);
    expect(kept.length).toBeGreaterThan(points(route).length / 2);
  });

  it("ends at the last of three passes, not the second", () => {
    const m = { lat: 48.11, lng: 11 };
    const away = (lat: number) => leg(48.11, lat, 11.005); // 370 m east, out of reach
    const route: Route = {
      segments: [
        [
          ...leg(48.1, 48.11, 11),
          ...away(48.13),
          ...leg(48.13, 48.11, 11.005),
          { lat: 48.11, lng: 11 },
          ...away(48.125),
          ...leg(48.125, 48.11, 11.005),
          { lat: 48.11, lng: 11 },
          ...leg(48.11, 48.1, 11),
        ],
      ],
    };
    const cut = cutToMeetingPoint(route, m);
    if (!cut.ok) throw new Error(cut.error);
    const kept = points(cut.value.route);
    // Both outings are kept, and the way home after the last pass is cut.
    expect(kept.some((point) => point.lat === 48.13)).toBe(true);
    expect(kept.some((point) => point.lat === 48.125)).toBe(true);
    expect(kept.at(-1)).toEqual({ lat: 48.11, lng: 11 });
  });

  it("cuts a route made of several segments across them", () => {
    const route: Route = {
      segments: [leg(48.1, 48.105, 11), leg(48.108, 48.13, 11), leg(48.13, 48.15, 11)],
    };
    const cut = cutToMeetingPoint(route, meeting);
    if (!cut.ok) throw new Error(cut.error);
    expect(cut.value.cut).toEqual({ start: true, end: false });
    expect(cut.value.route.segments).toHaveLength(2);
    expect(cut.value.route.segments[1]).toEqual(route.segments[2]);
    expect(nearHome(cut.value.route, 1000)).toBe(false);
  });

  it("refuses a cut that leaves fewer than two points", () => {
    const twoPoints: Route = { segments: [[home, meeting]] };
    expect(cutToMeetingPoint(twoPoints, meeting)).toEqual({
      ok: false,
      error: "route_trimmed_away",
    });
  });

  it("leaves a route that does not pass within 200 m of the meeting point", () => {
    const cut = cutToMeetingPoint(oneWay, { lat: 48.11, lng: 11.004 });
    if (!cut.ok) throw new Error(cut.error);
    expect(cut.value).toEqual({ route: oneWay, cut: { start: false, end: false } });
  });
});

describe("routeToKeep (decisions D13, D40)", () => {
  it("hides only the ends not cut at the meeting point", () => {
    const kept = routeToKeep(oneWay, { trimMeters: 500, meetingPoint: meeting });
    if (!kept.ok) throw new Error(kept.error);
    expect(distanceMeters(meeting, points(kept.value)[0]!)).toBeLessThanOrEqual(100);
    // The far end, perhaps someone's home too, loses its last 500 m.
    expect(points(kept.value).at(-1)!.lat).toBeLessThan(48.136);
    const loopKept = routeToKeep(loop, { trimMeters: 500, meetingPoint: meeting });
    if (!loopKept.ok) throw new Error(loopKept.error);
    expect(distanceMeters(meeting, points(loopKept.value).at(-1)!)).toBeLessThanOrEqual(100);
  });

  it("hides both ends where the plan has no meeting point on the map", () => {
    const kept = routeToKeep(oneWay, { trimMeters: 500, meetingPoint: undefined });
    if (!kept.ok) throw new Error(kept.error);
    expect(nearHome(kept.value, 450)).toBe(false);
    expect(routeToKeep(oneWay, { trimMeters: 0, meetingPoint: undefined })).toEqual({
      ok: true,
      value: oneWay,
    });
  });

  it("refuses a route that nothing would be left of", () => {
    const short: Route = { segments: [leg(48.1, 48.103, 11)] };
    expect(routeToKeep(short, { trimMeters: 500, meetingPoint: undefined })).toEqual({
      ok: false,
      error: "route_trimmed_away",
    });
  });
});
