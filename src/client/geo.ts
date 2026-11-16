// DOM-free helpers for the map scripts (tested in Node).

export const roundCoordinate = (value: number): string => {
  const rounded = Number(value.toFixed(5));
  return String(rounded === 0 ? 0 : rounded);
};

/**
 * The viewer's place for Nearby (decision D35): on the 0.02° grid (about 2 km) before it enters
 * the URL. The server rounds again, to the same grid.
 */
export const NEARBY_GRID_PER_DEGREE = 50;
export const nearbyCoordinate = (value: number): string => {
  const snapped = Number(
    (Math.round(value * NEARBY_GRID_PER_DEGREE) / NEARBY_GRID_PER_DEGREE).toFixed(2),
  );
  return String(snapped === 0 ? 0 : snapped);
};

/** A coordinate from an attribute or input, or undefined when empty, malformed or out of range. */
export function readCoordinate(value: string | undefined, axis: "lat" | "lng"): number | undefined {
  const text = value?.trim().replace(",", ".") ?? "";
  if (!/^-?\d+(\.\d+)?$/.test(text)) return undefined;
  const number = Number(text);
  return Math.abs(number) <= (axis === "lat" ? 90 : 180) ? number : undefined;
}

/** "Englischer Garten, Schwabing, Munich" → "Englischer Garten". */
export const shortLabel = (label: string): string => (label.split(",")[0] ?? "").trim();

/**
 * Whether a map tap may fill the meeting-area field (decision D70): it is empty, or still holds our
 * own earlier suggestion, unchanged. The host's own text is never replaced.
 */
export const shouldSuggest = (label: string, lastSuggestion: string | undefined): boolean =>
  label.trim() === "" || label === lastSuggestion;

/** For text that Leaflet inserts as HTML (the configured tile attribution). */
export const escapeHtml = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/**
 * The public area's grid: 100 lines per degree (0.01°, about 1 km). Mirrors PUBLIC_GRID_PER_DEGREE
 * in src/domain/geo.ts, which the client may not import; a test pins both to the same results.
 */
export const PUBLIC_GRID_PER_DEGREE = 100;

/** One coordinate on the public grid. Mirrors `snapToGrid` in src/domain/geo.ts, rounding included. */
export const snapPublicCoordinate = (value: number): number => {
  const snapped = Number(
    (Math.round(value * PUBLIC_GRID_PER_DEGREE) / PUBLIC_GRID_PER_DEGREE).toFixed(2),
  );
  return snapped === 0 ? 0 : snapped; // no negative zero
};

export interface Point {
  lat: number;
  lng: number;
}

/** The public point of a point. Mirrors `publicAreaFrom` in src/domain/geo.ts. */
export const publicPointOf = (point: Point): Point => ({
  lat: snapPublicCoordinate(point.lat),
  lng: snapPublicCoordinate(point.lng),
});

/**
 * Where the public area circle sits (spec 3.1): derived from the exact point when that is set,
 * else from the area point, as `publicSource` does in src/domain/plan-input.ts. Never the exact
 * point itself.
 */
export function publicCircleCenter(
  exact: Point | undefined,
  area: Point | undefined,
): Point | undefined {
  const source = exact ?? area;
  return source === undefined ? undefined : publicPointOf(source);
}

/** Zoom for "Find my location": street level, or wider when the fix is coarser than 2 km. */
export const zoomForAccuracy = (accuracyMeters: number): number =>
  accuracyMeters > 2000 ? 13 : 15;
