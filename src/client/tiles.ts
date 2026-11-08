import L from "leaflet";
import { escapeHtml } from "./geo.ts";

/** Tile layer from the server's data attributes; the attribution is configuration, shown as text. */
export function tileLayer(element: HTMLElement): L.TileLayer {
  return L.tileLayer(element.dataset.tileUrl ?? "", {
    attribution: escapeHtml(element.dataset.attribution ?? ""),
    maxZoom: 19,
  });
}

/** A plan color from the theme stylesheet, for Leaflet's SVG presentation attributes. */
export function themeColor(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** ~1 km grid cell around the public point (spec 3.1). */
export const AREA_RADIUS_M = 750;
