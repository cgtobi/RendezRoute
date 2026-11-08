// Form map (decision D12): tap to set the public area or the exact start, depending on the mode.
import L from "leaflet";
import { readCoordinate, roundCoordinate } from "./geo.ts";
import { PLACE_EVENT, type PickedPlace, setField } from "./places.ts";
import { AREA_RADIUS_M, createMap, themeColor, tileLayer } from "./tiles.ts";

type Mode = "area" | "exact";
const FIELDS: Record<Mode, [string, string]> = {
  area: ["areaLat", "areaLng"],
  exact: ["exactLat", "exactLng"],
};

export function initPickMaps(): void {
  for (const picker of document.querySelectorAll<HTMLElement>("[data-map-picker]")) {
    const form = picker.closest("form");
    const container = picker.querySelector<HTMLElement>(".map");
    if (form === null || container === null) continue;
    picker.hidden = false;

    const map = createMap(container, picker).setView([20, 0], 2);
    tileLayer(picker).addTo(map);
    const markers: Record<Mode, L.Circle | L.CircleMarker> = {
      area: L.circle([0, 0], {
        radius: AREA_RADIUS_M,
        color: themeColor("--plan-secondary", "#ff7a45"),
      }),
      exact: L.circleMarker([0, 0], {
        radius: 8,
        color: themeColor("--plan-primary", "#2e5bff"),
        fillOpacity: 0.8,
      }),
    };

    const point = (mode: Mode) => {
      const [latName, lngName] = FIELDS[mode];
      const lat = readCoordinate(
        form.querySelector<HTMLInputElement>(`[name="${latName}"]`)?.value,
        "lat",
      );
      const lng = readCoordinate(
        form.querySelector<HTMLInputElement>(`[name="${lngName}"]`)?.value,
        "lng",
      );
      return lat === undefined || lng === undefined ? undefined : L.latLng(lat, lng);
    };

    const sync = () => {
      for (const mode of ["area", "exact"] as const) {
        const at = point(mode);
        if (at === undefined) markers[mode].remove();
        else markers[mode].setLatLng(at).addTo(map);
      }
    };

    const currentMode = (): Mode =>
      picker.querySelector<HTMLInputElement>('input[name="mapMode"]:checked')?.value === "area"
        ? "area"
        : "exact";

    const set = (mode: Mode, lat: number, lng: number) => {
      const [latName, lngName] = FIELDS[mode];
      setField(form, latName, roundCoordinate(lat));
      setField(form, lngName, roundCoordinate(lng));
      sync();
    };

    map.on("click", (event: L.LeafletMouseEvent) =>
      set(currentMode(), event.latlng.lat, event.latlng.lng),
    );
    // pickPlace already set the area fields; the map only follows.
    picker.addEventListener(PLACE_EVENT, (event) => {
      const place = (event as CustomEvent<PickedPlace>).detail;
      map.setView([place.lat, place.lng], 14);
    });
    form.addEventListener("input", sync);

    sync();
    const start = point("exact") ?? point("area");
    if (start !== undefined) map.setView(start, 15);
  }
}
