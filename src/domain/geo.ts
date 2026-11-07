// Coordinates, the public area grid and the exact start (spec 3.1).
import { err, ok, type Result } from "./result.ts";

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** 0.01° ≈ 1 km: the public point never reveals more than the grid cell. */
const GRID = 100;
const MAX_DESCRIPTION_LENGTH = 200;

export function validateGeoPoint(point: GeoPoint): Result<GeoPoint, "coordinates_invalid"> {
  const valid =
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lng) <= 180;
  return valid ? ok(point) : err("coordinates_invalid");
}

function snap(value: number): number {
  const snapped = Number((Math.round(value * GRID) / GRID).toFixed(2));
  return snapped === 0 ? 0 : snapped; // no negative zero
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
