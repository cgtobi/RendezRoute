// Routes from GPX uploads (spec 5 feature 2, 3.8 Uploads, decisions P8 and D10).
import { type GeoPoint, validateGeoPoint } from "./geo.ts";
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
const EARTH_RADIUS_M = 6_371_008.8;

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

function haversine(a: RoutePoint, b: RoutePoint): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

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
      if (previous !== undefined) distance += haversine(previous, point);
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
