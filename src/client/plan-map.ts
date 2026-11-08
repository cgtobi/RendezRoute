// Plan map (decision D12): the public area for everyone; exact start and route only when the
// server put them on the page, i.e. for participants and the host (spec 3.6).
import L from "leaflet";
import { readCoordinate } from "./geo.ts";
import { AREA_RADIUS_M, themeColor, tileLayer } from "./tiles.ts";

export function initPlanMaps(): void {
  for (const element of document.querySelectorAll<HTMLElement>("[data-plan-map]")) {
    const areaLat = readCoordinate(element.dataset.areaLat, "lat");
    const areaLng = readCoordinate(element.dataset.areaLng, "lng");
    if (areaLat === undefined || areaLng === undefined) continue;
    element.hidden = false;

    const map = L.map(element, { scrollWheelZoom: false }).setView([areaLat, areaLng], 14);
    tileLayer(element).addTo(map);
    const primary = themeColor("--plan-primary", "#2e5bff");
    L.circle([areaLat, areaLng], {
      radius: AREA_RADIUS_M,
      color: themeColor("--plan-secondary", "#ff7a45"),
    }).addTo(map);

    const exactLat = readCoordinate(element.dataset.exactLat, "lat");
    const exactLng = readCoordinate(element.dataset.exactLng, "lng");
    if (exactLat !== undefined && exactLng !== undefined) {
      L.circleMarker([exactLat, exactLng], { radius: 8, color: primary, fillOpacity: 0.8 }).addTo(
        map,
      );
    }

    const routeUrl = element.dataset.routeUrl;
    if (routeUrl !== undefined) {
      void fetch(routeUrl, { credentials: "same-origin" })
        .then((response) =>
          response.ok ? (response.json() as Promise<GeoJSON.GeoJsonObject>) : undefined,
        )
        .then((route) => {
          if (route === undefined) return;
          const layer = L.geoJSON(route, { style: { color: primary, weight: 4 } }).addTo(map);
          map.fitBounds(layer.getBounds(), { padding: [16, 16] });
        })
        .catch(() => undefined);
    }
  }
}
