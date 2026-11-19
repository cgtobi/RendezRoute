// Nearby (decision D35): "Use my location" and the map set the viewer's place, rounded to the
// 0.02° grid before it enters the form, so the URL never holds more; neither sends the form by
// itself (spec 3.9: location only fills the form). A typed place is looked up through the place
// search endpoint first, so only its rounded point is sent; if that fails, the form goes as it is
// and the server looks it up. The full-screen map (ADR 008) sets the same point through the same
// controller, and its own place search never sends the form.
import L from "leaflet";
import { nearbyCoordinate, type Point, readCoordinate } from "./geo.ts";
import { addExpandControl, type MapDialogSetup } from "./map-dialog.ts";
import { lookUp, type LookUpResult } from "./nearby-lookup.ts";
import { createMap, themeColor, tileLayer } from "./tiles.ts";

/** A coarse fix is enough: it is rounded to about 2 km anyway. */
const LOCATE_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 10_000,
  maximumAge: 600_000,
};

/** The zoom a point from the device or a search is shown at, at least. */
const POINT_ZOOM = 11;

/** The server refuses shorter queries (MIN_QUERY in src/application/places.ts). */
const MIN_QUERY = 2;

/** How a press of "Use my location" ended. */
export type LocateResult = "set" | "denied" | "unavailable" | "aborted";

/** The viewer's point in one Nearby form, for the page map and the full-screen map alike. */
export interface NearbyController {
  /** The point in the form (already on the grid), if any. */
  point(): Point | undefined;
  /** Sets the point, rounded to the grid; the typed place goes, "Around the spot" shows. */
  setPoint(lat: number, lng: number): void;
  /** Forgets the point (the viewer types a place instead). */
  clear(): void;
  /** Called with the point after every change; returns the function that stops it. */
  subscribe(listener: (point: Point | undefined) => void): () => void;
  /**
   * Asks the browser for the position once and sets the point. Resolves "denied" or "unavailable"
   * when the browser refused or failed, "aborted" when `signal` was aborted before the fix came
   * (then nothing is set).
   */
  locate(signal?: AbortSignal): Promise<LocateResult>;
  /**
   * Looks the place up and sets the found point. Never sends the form. Without a geocoder it
   * fails at once.
   */
  search(query: string, signal?: AbortSignal): Promise<LookUpResult>;
}

/** The controller of a Nearby form; undefined without its hidden lat and lng fields. */
export function createNearbyController(form: HTMLFormElement): NearbyController | undefined {
  const lat = form.querySelector<HTMLInputElement>('input[name="lat"]');
  const lng = form.querySelector<HTMLInputElement>('input[name="lng"]');
  if (lat === null || lng === null) return undefined;
  const place = form.querySelector<HTMLInputElement>('input[name="place"]');
  const chosen = form.querySelector<HTMLElement>("[data-nearby-point]");
  const listeners = new Set<(point: Point | undefined) => void>();

  const point = (): Point | undefined => {
    const latitude = readCoordinate(lat.value, "lat");
    const longitude = readCoordinate(lng.value, "lng");
    return latitude === undefined || longitude === undefined
      ? undefined
      : { lat: latitude, lng: longitude };
  };
  const notify = () => {
    const now = point();
    for (const listener of listeners) listener(now);
  };

  const setPoint = (latitude: number, longitude: number) => {
    lat.value = nearbyCoordinate(latitude);
    lng.value = nearbyCoordinate(longitude);
    if (place !== null) place.value = "";
    if (chosen !== null) chosen.hidden = false;
    notify();
  };

  return {
    point,
    setPoint,
    clear: () => {
      lat.value = "";
      lng.value = "";
      if (chosen !== null) chosen.hidden = true;
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    locate: (signal) =>
      new Promise<LocateResult>((resolve) => {
        if (!("geolocation" in navigator)) {
          resolve("unavailable");
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (position) => {
            // A fix that arrives after the full-screen map closed does nothing.
            if (signal?.aborted === true) {
              resolve("aborted");
              return;
            }
            setPoint(position.coords.latitude, position.coords.longitude);
            resolve("set");
          },
          (error) => resolve(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable"),
          LOCATE_OPTIONS,
        );
      }),
    search: async (query, signal) => {
      const endpoint = form.dataset.geocode;
      if (endpoint === undefined) return { kind: "failed" };
      const result = await lookUp(endpoint, form.dataset.csrf ?? "", query, fetch, signal);
      if (result.kind === "found" && signal?.aborted !== true) setPoint(result.lat, result.lng);
      return result;
    },
  };
}

/** The circle that marks the viewer's point on a Nearby map. */
function pointMarker(): L.CircleMarker {
  return L.circleMarker([0, 0], {
    radius: 8,
    color: themeColor("--accent", "#2e5bff"),
    fillOpacity: 0.8,
  });
}

/**
 * "Use my location" (page and full-screen map): a press asks once; a refusal or failure ends the
 * button for the page's life (or the dialog's) and says why in its title. aria-disabled, not
 * disabled, so the focus stays on the button instead of dropping out of the modal dialog or to the
 * page; a press on it then does nothing. The visible text stays its name.
 */
function wireLocateButton(
  button: HTMLButtonElement,
  controller: NearbyController,
  onDone: (result: LocateResult) => void,
  signal?: AbortSignal,
): void {
  button.hidden = false;
  button.addEventListener(
    "click",
    () => {
      if (button.getAttribute("aria-disabled") === "true") return;
      void controller.locate(signal).then((result) => {
        if (result === "aborted" || signal?.aborted === true) return;
        if (result === "denied" || result === "unavailable") {
          button.setAttribute("aria-disabled", "true");
          const why =
            result === "denied" ? button.dataset.locateDenied : button.dataset.locateUnavailable;
          if (why !== undefined) button.title = why;
        }
        onDone(result);
      });
    },
    signal === undefined ? {} : { signal },
  );
}

/** Shows a point found by search or the device: centred, at least at the town zoom. */
function showFound(map: L.Map, point: Point): void {
  map.setView([point.lat, point.lng], Math.max(map.getZoom(), POINT_ZOOM));
}

/**
 * The full-screen map's place search (ADR 008): Enter or the magnifier looks the place up and sets
 * the point. It never sends the form; a newer search or closing the map drops an older answer.
 */
function wireDialogSearch(
  box: HTMLElement,
  controller: NearbyController,
  map: L.Map,
  signal: AbortSignal,
): void {
  const input = box.querySelector<HTMLInputElement>("input");
  const button = box.querySelector<HTMLButtonElement>("button");
  const status = box.querySelector<HTMLElement>("[data-search-status]");
  if (input === null || button === null || status === null) return;
  let current: AbortController | undefined;
  signal.addEventListener("abort", () => current?.abort(), { once: true });

  const run = async () => {
    const query = input.value.trim();
    if (Array.from(query).length < MIN_QUERY) {
      input.focus();
      return;
    }
    current?.abort();
    const mine = new AbortController();
    current = mine;
    status.textContent = "";
    const result = await controller.search(query, mine.signal);
    if (mine.signal.aborted) return;
    if (result.kind === "found") {
      const point = controller.point();
      if (point !== undefined) showFound(map, point);
    } else {
      status.textContent =
        (result.kind === "none" ? status.dataset.noResults : status.dataset.unavailable) ?? "";
    }
  };

  button.addEventListener("click", () => void run(), { signal });
  input.addEventListener(
    "keydown",
    (event) => {
      // keyCode 229: Enter that confirms an input-method composition (some browsers).
      if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      void run();
    },
    { signal },
  );
  // Typing drops the answer to the older text.
  input.addEventListener(
    "input",
    () => {
      current?.abort();
      status.textContent = "";
    },
    { signal },
  );
}

/**
 * Nearby's full-screen map: a tap sets the point as on the page map and centres it; "Use my
 * location" and the place search set it too. The page map follows every change through the
 * controller and takes this map's view on close.
 */
function nearbyDialogSetup(controller: NearbyController, pageMap: L.Map): MapDialogSetup {
  return ({ dialog, map, signal, onClose }) => {
    const marker = pointMarker();
    const status = dialog.querySelector<HTMLElement>("[data-nearby-status]");
    const show = (point: Point | undefined, centre: boolean) => {
      if (status !== null) status.hidden = point === undefined;
      if (point === undefined) {
        marker.remove();
        return;
      }
      const at = L.latLng(point.lat, point.lng);
      marker.setLatLng(at).addTo(map);
      if (!centre) return;
      if (map.getBounds().contains(at)) map.panTo(at);
      else map.setView(at, POINT_ZOOM);
    };
    show(controller.point(), false);
    onClose(controller.subscribe((point) => show(point, true)));
    onClose(() => pageMap.setView(map.getCenter(), map.getZoom(), { animate: false }));

    map.on("click", (event: L.LeafletMouseEvent) => {
      // A tap on a repeated world copy has a longitude beyond 180: wrap it into -180 to 180.
      const { lat, lng } = event.latlng.wrap();
      controller.setPoint(lat, lng);
    });

    const locate = dialog.querySelector<HTMLButtonElement>("[data-dialog-locate]");
    if (locate !== null && "geolocation" in navigator) {
      wireLocateButton(
        locate,
        controller,
        (result) => {
          const point = controller.point();
          if (result === "set" && point !== undefined) showFound(map, point);
        },
        signal,
      );
    }

    const search = dialog.querySelector<HTMLElement>("[data-map-dialog-search]");
    if (search !== null) wireDialogSearch(search, controller, map, signal);
  };
}

export function initNearby(): void {
  for (const form of document.querySelectorAll<HTMLFormElement>("form[data-nearby]")) {
    const controller = createNearbyController(form);
    if (controller === undefined) continue;
    const place = form.querySelector<HTMLInputElement>('input[name="place"]');
    // Whether the typed place was looked up for this submit already.
    let looked = false;

    place?.addEventListener("input", () => {
      looked = false;
      controller.clear();
    });

    const locate = form.querySelector<HTMLButtonElement>("[data-nearby-locate]");
    if (locate !== null && "geolocation" in navigator) {
      wireLocateButton(locate, controller, () => undefined);
    }

    if (place !== null && form.dataset.geocode !== undefined) {
      form.addEventListener("submit", (event) => {
        if (looked || place.value.trim() === "") return;
        event.preventDefault();
        looked = true;
        // Found or not, the form goes: without a point the server looks the place up itself.
        void controller.search(place.value).then(() => form.requestSubmit());
      });
    }

    const container = form.querySelector<HTMLElement>("[data-nearby-map]");
    if (container !== null) {
      container.hidden = false;
      const at = controller.point();
      const map = createMap(container, container).setView(
        at === undefined ? [20, 0] : [at.lat, at.lng],
        at === undefined ? 2 : POINT_ZOOM,
      );
      tileLayer(container).addTo(map);
      const marker = pointMarker();
      const show = (point: Point | undefined) => {
        if (point === undefined) {
          marker.remove();
          return;
        }
        const where = L.latLng(point.lat, point.lng);
        marker.setLatLng(where).addTo(map);
        // From the device, the spot may be anywhere: bring it into view.
        if (!map.getBounds().contains(where)) map.setView(where, POINT_ZOOM);
      };
      show(at);
      controller.subscribe(show);
      map.on("click", (event: L.LeafletMouseEvent) => {
        // A tap on a repeated world copy has a longitude beyond 180: wrap it into -180 to 180.
        const { lat, lng } = event.latlng.wrap();
        controller.setPoint(lat, lng);
      });

      const template = container.nextElementSibling;
      if (template instanceof HTMLTemplateElement && template.dataset.mapDialog === "nearby") {
        addExpandControl(map, template, container, nearbyDialogSetup(controller, map));
      }
    }
  }
}
