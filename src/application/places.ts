// Place search for the create and edit forms (spec 3.9).
import { publicAreaFrom, validateGeoPoint } from "../domain/geo.ts";
import type { Geocoder, Place } from "./ports.ts";

const MIN_QUERY = 2;
const MAX_QUERY = 100;

export async function searchPlaces(
  deps: { geocoder: Geocoder },
  request: { query: string; language: string },
): Promise<{ kind: "results"; places: Place[] } | { kind: "invalid" } | { kind: "unavailable" }> {
  const query = request.query.trim();
  const length = Array.from(query).length;
  if (length < MIN_QUERY || length > MAX_QUERY) return { kind: "invalid" };
  try {
    return {
      kind: "results",
      places: await deps.geocoder.search(query, { language: request.language }),
    };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * A suggested meeting-area name for a point on the map (decision D70). The point is put on the
 * public 0.01° grid here, so the geocoder (and any cache) never sees more than the grid cell,
 * whatever the caller sent.
 */
export async function suggestPlaceName(
  deps: { geocoder: Geocoder },
  request: { lat: number; lng: number; language: string },
): Promise<
  | { kind: "found"; label: string }
  | { kind: "none" }
  | { kind: "unavailable" }
  | { kind: "invalid" }
> {
  const valid = validateGeoPoint({ lat: request.lat, lng: request.lng });
  if (!valid.ok) return { kind: "invalid" };
  const cell = publicAreaFrom(valid.value);
  try {
    const label = await deps.geocoder.reverse(cell, { language: request.language });
    return label === undefined ? { kind: "none" } : { kind: "found", label };
  } catch {
    return { kind: "unavailable" };
  }
}
