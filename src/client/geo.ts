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

/** For text that Leaflet inserts as HTML (the configured tile attribution). */
export const escapeHtml = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
