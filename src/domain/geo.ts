// Coordinates, the public area grid and the exact start (spec 3.1).
import { err, ok, type Result } from "./result.ts";

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** 0.01° ≈ 1 km: the public point never reveals more than the grid cell. */
const PUBLIC_GRID_PER_DEGREE = 100;
/** The longest exact-start description (the form's maxlength and the suggestion's cut). */
export const MAX_DESCRIPTION_LENGTH = 200;

export function validateGeoPoint(point: GeoPoint): Result<GeoPoint, "coordinates_invalid"> {
  const valid =
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lng) <= 180;
  return valid ? ok(point) : err("coordinates_invalid");
}

/** The nearest point of a grid with `perDegree` lines per degree (100: 0.01°, 50: 0.02°). */
export function snapToGrid(value: number, perDegree: number): number {
  const snapped = Number((Math.round(value * perDegree) / perDegree).toFixed(2));
  return snapped === 0 ? 0 : snapped; // no negative zero
}

const snap = (value: number) => snapToGrid(value, PUBLIC_GRID_PER_DEGREE);

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in meters (haversine). */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Public point derived from an exact point: the nearest point on the 0.01° grid. */
export function publicAreaFrom(exact: GeoPoint): GeoPoint {
  return { lat: snap(exact.lat), lng: snap(exact.lng) };
}

export interface ExactStart {
  point: GeoPoint | undefined;
  description: string | undefined;
}

/** Coordinates and/or a short description; at least one (decision D2). */
export function validateExactStart(input: {
  point?: GeoPoint | undefined;
  description?: string | undefined;
}): Result<ExactStart, "exact_start_empty" | "exact_start_too_long" | "coordinates_invalid"> {
  const description = input.description?.trim() || undefined;
  if (input.point === undefined && description === undefined) return err("exact_start_empty");
  if (description !== undefined && Array.from(description).length > MAX_DESCRIPTION_LENGTH) {
    return err("exact_start_too_long");
  }
  if (input.point !== undefined) {
    const point = validateGeoPoint(input.point);
    if (!point.ok) return point;
  }
  return ok({ point: input.point, description });
}
