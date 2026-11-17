// Form map (decisions D12, D62, D66): tap to set the public area or the exact start, depending on
// the mode switch; a control finds the device's place (view only).
import L from "leaflet";
import { publicCircleCenter, readCoordinate, roundCoordinate, zoomForAccuracy } from "./geo.ts";
import { createDescriptionSuggester } from "./description-suggestion.ts";
import { createLabelSuggester } from "./label-suggestion.ts";
import { browserZone, openingView, operatorView } from "./map-view.ts";
import { PLACE_EVENT, type PickedPlace, setField } from "./places.ts";
import { AREA_RADIUS_M, createMap, themeColor, tileLayer } from "./tiles.ts";

type Mode = "area" | "exact";
const FIELDS: Record<Mode, [string, string]> = {
  area: ["areaLat", "areaLng"],
  exact: ["exactLat", "exactLng"],
};

/**
 * "Find my location" (decision D62): a button under the zoom buttons that only moves the view. It
 * never writes a field and never sets a point; a refusal or failure disables it and says why.
 */
function addLocateControl(map: L.Map, picker: HTMLElement): void {
  const title = picker.dataset.locateTitle ?? "Find my location";
  if (!("geolocation" in navigator)) return;
  const control = new L.Control({ position: "topleft" });
  control.onAdd = () => {
    const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
    const button = L.DomUtil.create("button", "map-locate", container);
    button.type = "button";
    button.title = title;
    button.setAttribute("aria-label", title);
    L.DomUtil.create("span", "map-locate-icon", button).setAttribute("aria-hidden", "true");
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.on(button, "click", () => {
      if (button.getAttribute("aria-disabled") === "true") return;
      navigator.geolocation.getCurrentPosition(
        (position) =>
          map.setView(
            [position.coords.latitude, position.coords.longitude],
            zoomForAccuracy(position.coords.accuracy),
          ),
        (error) => {
          // Any failure (refused, no position, timeout) ends the control for the page's life.
          // aria-disabled, not disabled, so focus stays on the button instead of dropping to the
          // page; the click handler ignores it.
          const why =
            error.code === error.PERMISSION_DENIED
              ? (picker.dataset.locateDenied ?? "Location access was refused")
              : (picker.dataset.locateUnavailable ?? "Your position is not available");
          button.setAttribute("aria-disabled", "true");
          button.title = why;
          button.setAttribute("aria-label", why);
        },
        { timeout: 10_000, maximumAge: 300_000 },
      );
    });
    return container;
  };
  control.addTo(map);
}

export function initPickMaps(): void {
  for (const picker of document.querySelectorAll<HTMLElement>("[data-map-picker]")) {
    const form = picker.closest("form");
    const container = picker.querySelector<HTMLElement>(".map");
    if (form === null || container === null) continue;
    picker.hidden = false;

    // Opens on the default place; the saved point (if any) replaces it once the form is read.
    const map = createMap(container, picker);
    const operator = operatorView(picker.dataset.defaultCenter, picker.dataset.defaultZoom);
    const opening = openingView({ saved: undefined, operator, zone: browserZone() });
    map.setView(opening.center, opening.zoom);
    tileLayer(picker).addTo(map);
    addLocateControl(map, picker);
    const markers: Record<"public" | "exact", L.Circle | L.CircleMarker> = {
      // The public area circle: around the exact point's grid cell when that is set (spec 3.1).
      public: L.circle([0, 0], {
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

    const readout = form.querySelector<HTMLElement>("[data-exact-readout]");
    const readoutSet = readout?.querySelector<HTMLElement>("[data-exact-set]") ?? undefined;
    const readoutNone = readout?.querySelector<HTMLElement>("[data-exact-none]") ?? undefined;
    const areaReadout = picker.querySelector<HTMLElement>("[data-area-readout]");
    const areaSet = areaReadout?.querySelector<HTMLElement>("[data-area-set]") ?? undefined;
    const areaNone = areaReadout?.querySelector<HTMLElement>("[data-area-none]") ?? undefined;

    const currentMode = (): Mode =>
      picker.querySelector<HTMLInputElement>('input[name="mapMode"]:checked')?.value === "exact"
        ? "exact"
        : "area";

    const caption = picker.querySelector<HTMLElement>("[data-map-caption]");
    // In area mode with an exact point set, the public area follows that point (spec 3.1), so a
    // tap would change nothing the server uses: the caption says so instead.
    const updateCaption = () => {
      if (caption === null) return;
      const text =
        currentMode() === "exact"
          ? caption.dataset.captionExact
          : point("exact") === undefined
            ? caption.dataset.captionArea
            : caption.dataset.captionAreaFollows;
      if (text !== undefined && caption.textContent !== text) caption.textContent = text;
    };

    // The area line is revealed with the rest, at the end of the setup.
    let revealed = false;
    const sync = () => {
      const exact = point("exact");
      const center = publicCircleCenter(exact, point("area"));
      if (center === undefined) markers.public.remove();
      else markers.public.setLatLng(center).addTo(map);
      if (exact === undefined) markers.exact.remove();
      else markers.exact.setLatLng(exact).addTo(map);
      if (readoutSet !== undefined) readoutSet.hidden = exact === undefined;
      if (readoutNone !== undefined) readoutNone.hidden = exact !== undefined;
      // The area line is for an area set on its own: with an exact point the public area follows
      // that point and the caption says so.
      if (revealed && areaReadout !== null) areaReadout.hidden = exact !== undefined;
      const area = point("area");
      if (areaSet !== undefined) areaSet.hidden = area === undefined;
      if (areaNone !== undefined) areaNone.hidden = area !== undefined;
      updateCaption();
    };

    // Undefined without the endpoint attribute (no geocoder): then a tap never looks anything up.
    const suggestLabel = createLabelSuggester(picker, form);
    // The same for the exact point's description (decision D77).
    const suggestDescription = createDescriptionSuggester(picker, form);

    const set = (mode: Mode, at: L.LatLng) => {
      // The public area follows an exact point: a tap in area mode is ignored (the caption says why).
      if (mode === "area" && point("exact") !== undefined) return;
      // A tap on a repeated world copy has a longitude beyond 180: wrap it into -180 to 180.
      const { lat, lng } = at.wrap();
      const [latName, lngName] = FIELDS[mode];
      setField(form, latName, roundCoordinate(lat));
      setField(form, lngName, roundCoordinate(lng));
      // The exact start sits in a fold that may be closed: open it, so its notice about who sees
      // the point is in view.
      if (mode === "exact") {
        form.querySelector(`[name="${lngName}"]`)?.closest("details")?.setAttribute("open", "");
      }
      sync();
      // After a tap only (not typing, search, Remove or pageshow): the public point, already
      // snapped, is the only thing a lookup may send (decision D70).
      const center = publicCircleCenter(point("exact"), point("area"));
      if (center !== undefined) suggestLabel?.(center);
      // The description lookup sends the exact point itself, as set by this tap (decision D77).
      if (mode === "exact") {
        const exact = point("exact");
        if (exact !== undefined) suggestDescription?.suggest({ lat: exact.lat, lng: exact.lng });
      }
    };

    map.on("click", (event: L.LeafletMouseEvent) => set(currentMode(), event.latlng));
    // pickPlace already set the area fields; the map only follows.
    picker.addEventListener(PLACE_EVENT, (event) => {
      const place = (event as CustomEvent<PickedPlace>).detail;
      map.setView([place.lat, place.lng], 14);
    });
    form.addEventListener("input", sync);
    picker.addEventListener("change", updateCaption);
    form.querySelector("[data-exact-remove]")?.addEventListener("click", () => {
      // A lookup still on its way must not fill the description for a point that is gone.
      suggestDescription?.cancel();
      // Our own suggestion described the point that is gone; the host's text stays.
      suggestDescription?.clearSuggestion();
      // The public area point can survive this Remove: a pending area-name lookup still runs.
      for (const name of FIELDS.exact) setField(form, name, "");
      // The button disappears with the point: keep focus on the line that replaces it.
      readoutNone?.focus();
    });
    form.querySelector("[data-area-remove]")?.addEventListener("click", () => {
      suggestLabel?.cancel();
      for (const name of FIELDS.area) setField(form, name, "");
      areaNone?.focus();
    });
    // Browsers restore radios and values on reload and history navigation.
    window.addEventListener("pageshow", sync);

    sync();
    const start = point("exact") ?? point("area");
    if (start !== undefined) {
      const saved = openingView({ saved: [start.lat, start.lng], operator, zone: undefined });
      map.setView(saved.center, saved.zoom);
    }

    // Last, so a failure above leaves the form as without the map: with the map, the exact point
    // is set by a tap and shown as one line; the typed coordinates stay in the form, submitted,
    // but out of sight unless one has an error to show.
    if (readout !== null) readout.hidden = false;
    revealed = true;
    sync();
    for (const row of form.querySelectorAll<HTMLElement>(
      "[data-exact-fields], [data-area-fields]",
    )) {
      row.hidden = row.querySelector(".field-invalid") === null;
    }
  }
}
