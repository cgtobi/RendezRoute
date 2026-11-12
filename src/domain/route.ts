// Routes from GPX uploads (spec 5 feature 2, 3.8 Uploads, decisions P8 and D10).
import { distanceMeters, type GeoPoint, validateGeoPoint } from "./geo.ts";
import type { PlanInput } from "./plan-input.ts";
import { err, ok, type Result } from "./result.ts";

export interface RoutePoint {
  lat: number;
  lng: number;
  ele?: number;
}

/** Track or route segments; gaps between segments are not part of the route. */
export interface Route {
  segments: RoutePoint[][];
}

export const ROUTE_LIMITS = { maxBytes: 5 * 1024 * 1024, maxPoints: 50_000 } as const;

/** Elevation changes below this are GPS noise, not climbing. */
const ELEVATION_THRESHOLD_M = 3;

export type RouteError = "route_empty" | "route_too_many_points" | "route_invalid";

const round = (value: number, digits: number) => Number(value.toFixed(digits));

/**
 * Checks limits and coordinates, drops segments with fewer than two points, and rounds
 * coordinates to 5 decimals (about a meter) and elevation to 0.1 m.
 */
export function validateRoute(route: Route): Result<Route, RouteError> {
  const total = route.segments.reduce((sum, segment) => sum + segment.length, 0);
  if (total > ROUTE_LIMITS.maxPoints) return err("route_too_many_points");
  const segments: RoutePoint[][] = [];
  for (const segment of route.segments) {
    if (segment.length < 2) continue;
    const cleaned: RoutePoint[] = [];
    for (const point of segment) {
      if (!validateGeoPoint({ lat: point.lat, lng: point.lng }).ok) return err("route_invalid");
      const rounded: RoutePoint = { lat: round(point.lat, 5), lng: round(point.lng, 5) };
      if (point.ele !== undefined && Number.isFinite(point.ele)) rounded.ele = round(point.ele, 1);
      cleaned.push(rounded);
    }
    segments.push(cleaned);
  }
  return segments.length === 0 ? err("route_empty") : ok({ segments });
}

/** Distances the host can hide at both ends of a route, in meters (decision D13). */
export const ROUTE_TRIM_OPTIONS = [0, 200, 500, 1000] as const;
export type RouteTrim = (typeof ROUTE_TRIM_OPTIONS)[number];

/** Which ends of a route a step applies to. */
export interface RouteEnds {
  start: boolean;
  end: boolean;
}

/** The form value; empty means no trimming. */
export function parseRouteTrim(value: string): Result<RouteTrim, "choice_invalid"> {
  if (value === "") return ok(0);
  const trim = ROUTE_TRIM_OPTIONS.find((option) => String(option) === value);
  return trim === undefined ? err("choice_invalid") : ok(trim);
}

type IndexedPoint = { point: RoutePoint; segment: number };

const flatten = (route: Route): IndexedPoint[] =>
  route.segments.flatMap((points, segment) => points.map((point) => ({ point, segment })));

/** The kept points back into segments; segments left with fewer than two points are dropped. */
function rebuild(points: readonly IndexedPoint[]): Result<Route, "route_trimmed_away"> {
  const segments: RoutePoint[][] = [];
  let previous: number | undefined;
  for (const { point, segment } of points) {
    if (segment !== previous) segments.push([]);
    segments.at(-1)!.push(point);
    previous = segment;
  }
  const kept = segments.filter((points) => points.length >= 2);
  return kept.length === 0 ? err("route_trimmed_away") : ok({ segments: kept });
}

/**
 * Hides where a recording started and ended (decision D13): drops the leading points within
 * `meters` (straight line) of the first point and the trailing points within `meters` of the
 * last point, across segments; an end already cut at the meeting point (D40) is left alone.
 * Segments left with fewer than two points are dropped.
 */
export function trimRoute(
  route: Route,
  meters: number,
  ends: RouteEnds,
): Result<Route, "route_trimmed_away"> {
  if (meters <= 0 || (!ends.start && !ends.end)) return ok(route);
  const points = flatten(route);
  const first = points[0]?.point;
  const last = points.at(-1)?.point;
  if (first === undefined || last === undefined) return err("route_trimmed_away");
  let start = 0;
  if (ends.start) {
    while (start < points.length && distanceMeters(first, points[start]!.point) <= meters) start++;
  }
  let end = points.length;
  if (ends.end) {
    while (end > start && distanceMeters(last, points[end - 1]!.point) <= meters) end--;
  }
  return rebuild(points.slice(start, end));
}

/** How near a route must pass the meeting point to be cut there (decision D40). */
export const MEETING_POINT_RADIUS_M = 200;

/**
 * Cuts a route to the meeting point (decision D40), so a recording from home does not show it. A
 * pass is a run of consecutive points within 200 m of it. The route begins at the point nearest
 * to the meeting point in its first pass and, where it passes there again (a loop), ends at the
 * point nearest to it in its last pass; whatever lies between, laps included, is kept. Without a
 * pass an end stays for `trimRoute` to hide.
 */
export function cutToMeetingPoint(
  route: Route,
  meetingPoint: GeoPoint,
): Result<{ route: Route; cut: RouteEnds }, "route_trimmed_away"> {
  const points = flatten(route);
  const passes: { nearest: number; distance: number }[] = [];
  let inside = false;
  points.forEach(({ point }, index) => {
    const distance = distanceMeters(meetingPoint, point);
    if (distance > MEETING_POINT_RADIUS_M) {
      inside = false;
      return;
    }
    const current = passes.at(-1);
    if (!inside || current === undefined) passes.push({ nearest: index, distance });
    else if (distance < current.distance) {
      current.nearest = index;
      current.distance = distance;
    }
    inside = true;
  });
  const first = passes[0];
  const last = passes.length > 1 ? passes.at(-1) : undefined;
  if (first === undefined) return ok({ route, cut: { start: false, end: false } });
  const kept = rebuild(
    points.slice(first.nearest, last === undefined ? undefined : last.nearest + 1),
  );
  return kept.ok ? ok({ route: kept.value, cut: { start: true, end: last !== undefined } }) : kept;
}

/**
 * What of an upload is kept (decisions D13, D40): cut to the meeting point where the plan has
 * one with coordinates, then its other ends hidden as the host chose. Nothing else is stored.
 */
export function routeToKeep(
  route: Route,
  { trimMeters, meetingPoint }: { trimMeters: number; meetingPoint: GeoPoint | undefined },
): Result<Route, "route_trimmed_away"> {
  if (meetingPoint === undefined) return trimRoute(route, trimMeters, { start: true, end: true });
  const cut = cutToMeetingPoint(route, meetingPoint);
  if (!cut.ok) return cut;
  return trimRoute(cut.value.route, trimMeters, {
    start: !cut.value.cut.start,
    end: !cut.value.cut.end,
  });
}

/** The default of "Hide the start and end of the route" on the forms (decision D40). */
export const DEFAULT_ROUTE_TRIM = 500;

export interface RouteStats {
  distanceMeters: number;
  /** Undefined when the route has no elevation data. */
  elevationGainMeters: number | undefined;
  start: GeoPoint;
}

/** Distance along each segment and elevation gain with a 3 m threshold (decision D10). */
export function routeStats(route: Route): RouteStats {
  let distance = 0;
  let gain = 0;
  let hasElevation = false;
  for (const segment of route.segments) {
    let reference: number | undefined;
    segment.forEach((point, index) => {
      const previous = segment[index - 1];
      if (previous !== undefined) distance += distanceMeters(previous, point);
      if (point.ele === undefined) return;
      hasElevation = true;
      if (reference === undefined) {
        reference = point.ele;
      } else if (point.ele - reference >= ELEVATION_THRESHOLD_M) {
        gain += point.ele - reference;
        reference = point.ele;
      } else if (reference - point.ele >= ELEVATION_THRESHOLD_M) {
        reference = point.ele;
      }
    });
  }
  const first = route.segments[0]?.[0] ?? { lat: 0, lng: 0 };
  return {
    distanceMeters: Math.round(distance),
    elevationGainMeters: hasElevation ? Math.round(gain) : undefined,
    start: { lat: first.lat, lng: first.lng },
  };
}

/**
 * Form values from a route (decision P8, D10). "fill" (creating) sets only empty distance and
 * elevation; "replace" (host page upload) sets them from the route. Both set the exact start
 * coordinates only when none are given.
 */
export function applyRouteDefaults(
  input: PlanInput,
  stats: RouteStats,
  mode: "fill" | "replace",
): PlanInput {
  const set = (current: string, value: string | undefined) =>
    value === undefined ? current : mode === "replace" || current.trim() === "" ? value : current;
  const noExactPoint = input.exactLat.trim() === "" && input.exactLng.trim() === "";
  return {
    ...input,
    distanceKm: set(input.distanceKm, String(stats.distanceMeters / 1000)),
    elevationGainM: set(
      input.elevationGainM,
      stats.elevationGainMeters === undefined ? undefined : String(stats.elevationGainMeters),
    ),
    exactLat: noExactPoint ? String(stats.start.lat) : input.exactLat,
    exactLng: noExactPoint ? String(stats.start.lng) : input.exactLng,
  };
}
