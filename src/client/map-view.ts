// Where the form map opens (decision D63). Pure, so the order is tested without a browser.
import { ZONE_CENTRES } from "./zone-centres.ts";

export type LatLngTuple = [number, number];
export interface OpeningView {
  center: LatLngTuple;
  zoom: number;
}

/** Zoom for a saved point, as before. */
export const SAVED_ZOOM = 15;
/** Zoom for the browser zone's center and for Berlin: a country or region. */
export const ZONE_ZOOM = 6;
/** The last resort when the zone has no place (UTC, Etc/*) or the browser does not tell. */
export const FALLBACK_CENTER: LatLngTuple = [52.52, 13.405];

/**
 * The opening view, in this order: a saved point (exact start, else area) at zoom 15; the
 * operator's center with the operator's zoom; the center of the browser's time zone at zoom 6;
 * Berlin at zoom 6.
 */
export function openingView(input: {
  saved: LatLngTuple | undefined;
  operator: OpeningView | undefined;
  /** The browser's own zone, not the form's select (another script sets that one). */
  zone: string | undefined;
}): OpeningView {
  if (input.saved !== undefined) return { center: input.saved, zoom: SAVED_ZOOM };
  if (input.operator !== undefined) return input.operator;
  const centre = input.zone === undefined ? undefined : ZONE_CENTRES[input.zone];
  return {
    center: centre === undefined ? FALLBACK_CENTER : [centre[0], centre[1]],
    zoom: ZONE_ZOOM,
  };
}

/** The browser's time zone, or undefined when Intl is missing or fails. */
export function browserZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

const NUMBER = /^[+-]?\d{1,3}(?:\.\d{1,10})?$/;

/** The server's `data-default-center`, "lat,lng"; undefined when absent or malformed. */
export function parseDefaultCenter(text: string | undefined): LatLngTuple | undefined {
  const parts = text?.split(",");
  if (parts?.length !== 2) return undefined;
  const [latText = "", lngText = ""] = parts.map((part) => part.trim());
  if (!NUMBER.test(latText) || !NUMBER.test(lngText)) return undefined;
  const lat = Number(latText);
  const lng = Number(lngText);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : undefined;
}

/** The server's `data-default-zoom`: a whole number from 2 to 12, else undefined. */
export function parseDefaultZoom(text: string | undefined): number | undefined {
  if (text === undefined || !/^\d{1,2}$/.test(text)) return undefined;
  const zoom = Number(text);
  return zoom >= 2 && zoom <= 12 ? zoom : undefined;
}

/** The operator's view from the picker's data attributes; a center without a zoom opens at 6. */
export function operatorView(
  center: string | undefined,
  zoom: string | undefined,
): OpeningView | undefined {
  const parsed = parseDefaultCenter(center);
  return parsed === undefined
    ? undefined
    : { center: parsed, zoom: parseDefaultZoom(zoom) ?? ZONE_ZOOM };
}
