// DOM-free helpers for the map scripts (tested in Node).

export const roundCoordinate = (value: number): string => {
  const rounded = Number(value.toFixed(5));
  return String(rounded === 0 ? 0 : rounded);
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
