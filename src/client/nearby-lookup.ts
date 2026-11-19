// Looking a typed place up for Nearby (decision D35, ADR 008): through the instance's own
// CSRF-protected place search endpoint, so only the first result's point is used and the typed
// text never enters the URL. No Leaflet and no DOM here, so it can be tested in Node.

export type LookUpResult =
  | { kind: "found"; lat: number; lng: number }
  | { kind: "none" }
  | { kind: "failed" };

const isCoordinate = (value: unknown, limit: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;

/**
 * The first place search result for `query`: found with its point, none when the search found
 * nothing, failed when the endpoint refused or did not answer (or the lookup was aborted).
 */
export async function lookUp(
  endpoint: string,
  csrf: string,
  query: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<LookUpResult> {
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ q: query }),
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) return { kind: "failed" };
    const body = (await response.json()) as { places?: unknown };
    if (!Array.isArray(body.places)) return { kind: "failed" };
    const first: unknown = body.places[0];
    if (first === undefined) return { kind: "none" };
    const { lat, lng } = first as { lat?: unknown; lng?: unknown };
    if (!isCoordinate(lat, 90) || !isCoordinate(lng, 180)) return { kind: "failed" };
    return { kind: "found", lat, lng };
  } catch {
    return { kind: "failed" };
  }
}
