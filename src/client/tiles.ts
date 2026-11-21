import L from "leaflet";
import { attributionHtml } from "./geo.ts";

/** Tile layer from the server's data attributes; the attribution is configuration, shown as escaped text with the OSM name linked. */
export function tileLayer(element: HTMLElement): L.TileLayer {
  return L.tileLayer(element.dataset.tileUrl ?? "", {
    attribution: attributionHtml(element.dataset.attribution ?? ""),
    maxZoom: 19,
    // The OSM tile usage policy requires a Referer. Leaflet's tiles follow the page's policy,
    // and a page may be stricter (/nearby sends no-referrer), so ask for the origin only.
    referrerPolicy: "strict-origin",
  });
}

/** A map with zoom buttons titled in the page language (decision D15). */
export function createMap(
  element: HTMLElement,
  settings: HTMLElement,
  options: L.MapOptions = {},
): L.Map {
  const map = L.map(element, { ...options, zoomControl: false });
  L.control
    .zoom({
      zoomInTitle: settings.dataset.zoomIn ?? "Zoom in",
      zoomOutTitle: settings.dataset.zoomOut ?? "Zoom out",
    })
    .addTo(map);
  return map;
}

/** A plan color from the theme stylesheet, for Leaflet's SVG presentation attributes. */
export function themeColor(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
