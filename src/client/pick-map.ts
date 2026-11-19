// Form map (decisions D12, D62, D66): tap to set the public area or the exact start, depending on
// the mode switch; a control finds the device's place (view only). The full-screen view (ADR 008)
// sets the same fields through the same controller; both maps follow the form's input events.
import L from "leaflet";
import {
  AREA_RADIUS_M,
  type Point,
  publicCircleCenter,
  readCoordinate,
  roundCoordinate,
  zoomForAccuracy,
} from "./geo.ts";
import { createDescriptionSuggester } from "./description-suggestion.ts";
import { createLabelSuggester } from "./label-suggestion.ts";
import { addLocateControl, locateTexts } from "./locate-control.ts";
import { addExpandControl, type MapDialogSetup } from "./map-dialog.ts";
import { browserZone, openingView, operatorView } from "./map-view.ts";
import {
  type CaptionKind,
  captionFor,
  type PickMode,
  pointStatus,
  removeTarget,
  tapEffect,
} from "./pick-rule.ts";
import { PLACE_EVENT, type PickedPlace, setField } from "./places.ts";
import { createMap, themeColor, tileLayer } from "./tiles.ts";

const FIELDS: Record<PickMode, [string, string]> = {
  area: ["areaLat", "areaLng"],
  exact: ["exactLat", "exactLng"],
};

/** The form's two points and what a tap or Remove does to them, for the page map and the dialog. */
export interface PickController {
  /** The point in the form's fields, if they hold a valid one. */
  point(mode: PickMode): L.LatLng | undefined;
  /** Sets the point of `mode` where the map was tapped; false when the tap is ignored. */
  set(mode: PickMode, at: L.LatLng): boolean;
  /** Empties the point's fields and drops a lookup still on its way for it. */
  remove(mode: PickMode): void;
  /** The page's mode switch. */
  pageMode(): PickMode;
}

/** The controller of one form picker; its label and description suggesters are created once. */
export function createPickController(form: HTMLFormElement, picker: HTMLElement): PickController {
  const point = (mode: PickMode) => {
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

  // Undefined without the endpoint attribute (no geocoder): then a tap never looks anything up.
  const suggestLabel = createLabelSuggester(picker, form);
  // The same for the exact point's description (decision D77).
  const suggestDescription = createDescriptionSuggester(picker, form);

  return {
    point,
    pageMode: () =>
      picker.querySelector<HTMLInputElement>('input[name="mapMode"]:checked')?.value === "exact"
        ? "exact"
        : "area",
    set: (mode, at) => {
      // The public area follows an exact point: an area tap is ignored (the caption says why).
      if (tapEffect(mode, point("exact") !== undefined) === "ignored") return false;
      // A tap on a repeated world copy has a longitude beyond 180: wrap it into -180 to 180.
      const { lat, lng } = at.wrap();
      const [latName, lngName] = FIELDS[mode];
      // Through setField: the input events redraw both maps and tell the save bar.
      setField(form, latName, roundCoordinate(lat));
      setField(form, lngName, roundCoordinate(lng));
      // The exact start sits in a fold that may be closed: open it, so its notice about who sees
      // the point is in view.
      if (mode === "exact") {
        form.querySelector(`[name="${lngName}"]`)?.closest("details")?.setAttribute("open", "");
      }
      // After a tap only (not typing, search, Remove or pageshow): the public point, already
      // snapped, is the only thing a lookup may send (decision D70).
      const center = publicCircleCenter(point("exact"), point("area"));
      if (center !== undefined) suggestLabel?.(center);
      // The description lookup sends the exact point itself, as set by this tap (decision D77).
      if (mode === "exact") {
        const exact = point("exact");
        if (exact !== undefined) suggestDescription?.suggest({ lat: exact.lat, lng: exact.lng });
      }
      return true;
    },
    remove: (mode) => {
      if (mode === "exact") {
        // A lookup still on its way must not fill the description for a point that is gone.
        suggestDescription?.cancel();
        // Our own suggestion described the point that is gone; the host's text stays.
        suggestDescription?.clearSuggestion();
      } else {
        // An exact point can survive this Remove; the area name lookup for the old area goes.
        suggestLabel?.cancel();
      }
      for (const name of FIELDS[mode]) setField(form, name, "");
    },
  };
}

/** The area circle and exact start marker on one map. */
export interface PointLayers {
  sync(exact: Point | undefined, area: Point | undefined): void;
}

/** The form's two points as layers of `map`; one per map. */
export function createPointLayers(map: L.Map): PointLayers {
  // The public area circle: around the exact point's grid cell when that is set (spec 3.1).
  const circle = L.circle([0, 0], {
    radius: AREA_RADIUS_M,
    color: themeColor("--plan-secondary", "#ff7a45"),
    className: "map-area",
  });
  const marker = L.circleMarker([0, 0], {
    radius: 8,
    color: themeColor("--plan-primary", "#2e5bff"),
    fillOpacity: 0.8,
    className: "map-exact",
  });
  return {
    sync: (exact, area) => {
      const center = publicCircleCenter(exact, area);
      if (center === undefined) circle.remove();
      else circle.setLatLng([center.lat, center.lng]).addTo(map);
      if (exact === undefined) marker.remove();
      else marker.setLatLng([exact.lat, exact.lng]).addTo(map);
    },
  };
}

/** Puts the caption's text for `kind` (from its `data-caption-*` attributes) into it. */
export function applyCaption(caption: HTMLElement | null, kind: CaptionKind): void {
  if (caption === null) return;
  const text =
    kind === "exact"
      ? caption.dataset.captionExact
      : kind === "areaFollows"
        ? caption.dataset.captionAreaFollows
        : caption.dataset.captionArea;
  if (text !== undefined && caption.textContent !== text) caption.textContent = text;
}

/** "Find my location" (decision D62) on a form map: only moves the view, never sets a point. */
function addFindMe(map: L.Map, picker: HTMLElement, signal?: AbortSignal): void {
  addLocateControl(map, locateTexts(picker, "Find my location"), (position) => {
    if (signal?.aborted === true) return;
    map.setView(
      [position.coords.latitude, position.coords.longitude],
      zoomForAccuracy(position.coords.accuracy),
    );
  });
}

/**
 * The form map's full-screen view (ADR 008): its mode switch starts as the page's and sets the
 * page's when changed; a tap sets the point of its mode in the page form; the status line names the
 * point that is set and Remove point removes that one (lead decision 2). The page map follows the
 * form and takes this map's view on close.
 */
function pickDialogSetup(
  form: HTMLFormElement,
  picker: HTMLElement,
  controller: PickController,
  pageMap: L.Map,
): MapDialogSetup {
  return ({ dialog, map, signal, onClose }) => {
    const radios = [...dialog.querySelectorAll<HTMLInputElement>('input[name="mapModeFull"]')];
    const dialogMode = (): PickMode =>
      radios.find((radio) => radio.checked)?.value === "exact" ? "exact" : "area";
    const start = controller.pageMode();
    for (const radio of radios) radio.checked = radio.value === start;

    const layers = createPointLayers(map);
    const caption = dialog.querySelector<HTMLElement>("[data-map-caption]");
    const status = dialog.querySelector<HTMLElement>("[data-point-status]");
    const remove = dialog.querySelector<HTMLButtonElement>("[data-point-remove]");
    const shownStatus = () => pointStatus(controller.point("exact"), controller.point("area"));

    const redraw = () => {
      const exact = controller.point("exact");
      layers.sync(exact, controller.point("area"));
      applyCaption(caption, captionFor(dialogMode(), exact !== undefined));
      const shown = shownStatus();
      for (const line of status?.querySelectorAll<HTMLElement>("[data-status]") ?? []) {
        const hidden = line.dataset.status !== shown;
        if (line.hidden !== hidden) line.hidden = hidden;
      }
      if (remove !== null) remove.hidden = shown === "none";
    };

    for (const radio of radios) {
      radio.addEventListener(
        "change",
        () => {
          // The page's switch follows, so the page map's caption and the next page tap agree.
          const page = picker.querySelector<HTMLInputElement>(
            `input[name="mapMode"][value="${radio.value}"]`,
          );
          if (page !== null && !page.checked) {
            page.checked = true;
            page.dispatchEvent(new Event("change", { bubbles: true }));
          }
          redraw();
        },
        { signal },
      );
    }

    map.on("click", (event: L.LeafletMouseEvent) => {
      controller.set(dialogMode(), event.latlng);
    });
    // Taps here, Remove point, and anything the page changes while open (Discard, pageshow).
    form.addEventListener("input", redraw, { signal });
    remove?.addEventListener(
      "click",
      () => {
        const target = removeTarget(shownStatus());
        if (target !== undefined) controller.remove(target);
        // The button may disappear with the point: keep focus on the line that says what is left.
        status?.focus();
      },
      { signal },
    );
    addFindMe(map, picker, signal);
    onClose(() => pageMap.setView(map.getCenter(), map.getZoom(), { animate: false }));
    redraw();
  };
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
    // "Find my location" (decision D62): only moves the view. It never writes a field and never
    // sets a point.
    addFindMe(map, picker);
    const controller = createPickController(form, picker);
    const layers = createPointLayers(map);

    const readout = form.querySelector<HTMLElement>("[data-exact-readout]");
    const readoutSet = readout?.querySelector<HTMLElement>("[data-exact-set]") ?? undefined;
    const readoutNone = readout?.querySelector<HTMLElement>("[data-exact-none]") ?? undefined;
    const areaReadout = picker.querySelector<HTMLElement>("[data-area-readout]");
    const areaSet = areaReadout?.querySelector<HTMLElement>("[data-area-set]") ?? undefined;
    const areaNone = areaReadout?.querySelector<HTMLElement>("[data-area-none]") ?? undefined;
    const caption = picker.querySelector<HTMLElement>("[data-map-caption]");

    // In area mode with an exact point set, the public area follows that point (spec 3.1), so a
    // tap would change nothing the server uses: the caption says so instead.
    const updateCaption = () =>
      applyCaption(
        caption,
        captionFor(controller.pageMode(), controller.point("exact") !== undefined),
      );

    // The area line is revealed with the rest, at the end of the setup.
    let revealed = false;
    const sync = () => {
      const exact = controller.point("exact");
      const area = controller.point("area");
      layers.sync(exact, area);
      if (readoutSet !== undefined) readoutSet.hidden = exact === undefined;
      if (readoutNone !== undefined) readoutNone.hidden = exact !== undefined;
      // The area line is for an area set on its own: with an exact point the public area follows
      // that point and the caption says so.
      if (revealed && areaReadout !== null) areaReadout.hidden = exact !== undefined;
      if (areaSet !== undefined) areaSet.hidden = area === undefined;
      if (areaNone !== undefined) areaNone.hidden = area !== undefined;
      updateCaption();
    };

    map.on("click", (event: L.LeafletMouseEvent) => {
      controller.set(controller.pageMode(), event.latlng);
    });
    // pickPlace already set the area fields; the map only follows.
    picker.addEventListener(PLACE_EVENT, (event) => {
      const place = (event as CustomEvent<PickedPlace>).detail;
      map.setView([place.lat, place.lng], 14);
    });
    form.addEventListener("input", sync);
    picker.addEventListener("change", updateCaption);
    form.querySelector("[data-exact-remove]")?.addEventListener("click", () => {
      controller.remove("exact");
      // The button disappears with the point: keep focus on the line that replaces it.
      readoutNone?.focus();
    });
    form.querySelector("[data-area-remove]")?.addEventListener("click", () => {
      controller.remove("area");
      areaNone?.focus();
    });
    // Browsers restore radios and values on reload and history navigation.
    window.addEventListener("pageshow", sync);

    sync();
    const start = controller.point("exact") ?? controller.point("area");
    if (start !== undefined) {
      const saved = openingView({ saved: [start.lat, start.lng], operator, zone: undefined });
      map.setView(saved.center, saved.zoom);
    }

    // The full-screen icon (ADR 008): only with its template and a browser with modal dialogs.
    const template = picker.querySelector<HTMLTemplateElement>(
      ':scope > template[data-map-dialog="pick"]',
    );
    if (template !== null) {
      addExpandControl(map, template, picker, pickDialogSetup(form, picker, controller, map));
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
