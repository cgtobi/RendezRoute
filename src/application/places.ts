// Place search for the create and edit forms (spec 3.9).
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
