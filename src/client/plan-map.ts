// Plan map (decision D12): the public area for everyone; exact start and route only when the
// server put them on the page, i.e. for participants and the host (spec 3.6). The full-screen view
// (ADR 008) draws the same layers from the same data attributes, adds a key and "Show where I am".
import L from "leaflet";
import { AREA_RADIUS_M, type Point, readCoordinate } from "./geo.ts";
import { addLocateControl, locateTexts } from "./locate-control.ts";
import { addExpandControl, type MapDialogSetup } from "./map-dialog.ts";
import { legendEntries, locateView, type MapView, planFocus } from "./plan-view.ts";
import { createMap, themeColor, tileLayer } from "./tiles.ts";

/** What the page map's data attributes say: the public area, and what the audience may see. */
export interface PlanSource {
  area: Point;
  exact: Point | undefined;
  routeUrl: string | undefined;
}

const FIT_PADDING: L.FitBoundsOptions = { padding: [16, 16] };

/** "Show where I am" (lead decision 6): a fresh, precise fix; a minute-old one is fine. */
const SHOW_ME_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15_000,
  maximumAge: 60_000,
};

/** The plan source from a page map element; undefined without a valid area point. */
export function readPlanSource(element: HTMLElement): PlanSource | undefined {
  const areaLat = readCoordinate(element.dataset.areaLat, "lat");
  const areaLng = readCoordinate(element.dataset.areaLng, "lng");
  if (areaLat === undefined || areaLng === undefined) return undefined;
  const exactLat = readCoordinate(element.dataset.exactLat, "lat");
  const exactLng = readCoordinate(element.dataset.exactLng, "lng");
  return {
    area: { lat: areaLat, lng: areaLng },
    exact:
      exactLat === undefined || exactLng === undefined
        ? undefined
        : { lat: exactLat, lng: exactLng },
    routeUrl: element.dataset.routeUrl,
  };
}

/**
 * The route files of this page, parsed, one promise per URL (lead decision 4): the page map and
 * the full-screen map share one request to the gated endpoint. A failed load is forgotten, so the
 * next full-screen view tries once more. Memory only: nothing is stored, no HTTP cache changes.
 * The bounds of a drawn route are kept beside it, so a full-screen view opens on them at once.
 */
const routes = new Map<string, Promise<GeoJSON.GeoJsonObject | undefined>>();
const routeBounds = new Map<string, L.LatLngBounds>();

/**
 * Leaving the page (also into the back-forward cache) forgets them: a page shown again from that
 * cache asks the gated endpoint again instead of reusing what an earlier visit could see.
 */
function forgetRoutes(): void {
  routes.clear();
  routeBounds.clear();
}

function loadRoute(url: string): Promise<GeoJSON.GeoJsonObject | undefined> {
  const known = routes.get(url);
  if (known !== undefined) return known;
  const loading = fetch(url, { credentials: "same-origin" })
    .then((response) =>
      response.ok ? (response.json() as Promise<GeoJSON.GeoJsonObject>) : undefined,
    )
    .catch(() => undefined)
    .then((route) => {
      if (route === undefined) routes.delete(url);
      return route;
    });
  routes.set(url, loading);
  return loading;
}

/**
 * The plan's layers on a map: the area circle, the exact start and the route, each only when the
 * source has it. Resolves to the route's bounds once it is drawn, or undefined (no route, or it
 * failed to load). After `signal` aborts (the map is gone) nothing more is drawn.
 */
export function drawPlanLayers(
  map: L.Map,
  source: PlanSource,
  signal?: AbortSignal,
): Promise<L.LatLngBounds | undefined> {
  const primary = themeColor("--plan-primary", "#2e5bff");
  L.circle([source.area.lat, source.area.lng], {
    radius: AREA_RADIUS_M,
    color: themeColor("--plan-secondary", "#ff7a45"),
    className: "map-area",
  }).addTo(map);
  if (source.exact !== undefined) {
    L.circleMarker([source.exact.lat, source.exact.lng], {
      radius: 8,
      color: primary,
      fillOpacity: 0.8,
      className: "map-exact",
    }).addTo(map);
  }
  const url = source.routeUrl;
  if (url === undefined) return Promise.resolve(undefined);
  return loadRoute(url).then((route) => {
    if (route === undefined || signal?.aborted === true) return undefined;
    const layer = L.geoJSON(route, {
      style: { color: primary, weight: 4, className: "map-route" },
    }).addTo(map);
    const bounds = layer.getBounds();
    if (!bounds.isValid()) return undefined;
    routeBounds.set(url, bounds);
    return bounds;
  });
}

/** A view from plan-view.ts on a Leaflet map. */
function show(map: L.Map, view: MapView): void {
  if (view.kind === "point") {
    map.setView([view.center.lat, view.center.lng], view.zoom);
  } else {
    map.fitBounds(
      [
        [view.southWest.lat, view.southWest.lng],
        [view.northEast.lat, view.northEast.lng],
      ],
      { ...FIT_PADDING, maxZoom: 16 },
    );
  }
}

/** The key (`<ul data-map-legend>` from the template) as a control at the bottom left. */
function addLegend(map: L.Map, legend: HTMLElement): void {
  const control = new L.Control({ position: "bottomleft" });
  control.onAdd = () => {
    const container = L.DomUtil.create("div", "leaflet-control");
    container.append(legend);
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    return container;
  };
  control.addTo(map);
}

/** The full-screen plan map: the plan's layers, its key and "Show where I am". */
function planDialogSetup(source: PlanSource): MapDialogSetup {
  return ({ dialog, map, signal }) => {
    // The first view, before the dialog adds its tiles: the route's bounds when the page map has
    // drawn it already, else the plan's point (the route refits once it arrives).
    const known = source.routeUrl === undefined ? undefined : routeBounds.get(source.routeUrl);
    if (known === undefined) show(map, planFocus(source.area, source.exact));
    else map.fitBounds(known, { ...FIT_PADDING, animate: false });
    // Once the person asked for their position, the route arriving late does not move the view.
    let located = false;

    const legend = dialog.querySelector<HTMLElement>("[data-map-legend]");
    if (legend !== null) addLegend(map, legend);
    const hasExact = source.exact !== undefined;
    const hasRoute = source.routeUrl !== undefined;
    void drawPlanLayers(map, source, signal).then((bounds) => {
      if (signal.aborted) return;
      const entries = legendEntries({ hasExact, hasRoute, routeLoaded: bounds !== undefined });
      for (const item of legend?.querySelectorAll<HTMLElement>("[data-legend]") ?? []) {
        item.hidden = !entries.some((entry) => entry === item.dataset.legend);
      }
      if (bounds !== undefined && !located) map.fitBounds(bounds, FIT_PADDING);
    });

    // The position lives in these two layers only: never sent, never stored, gone with the map.
    const status = dialog.querySelector<HTMLElement>("[data-map-status]");
    const focusColour = themeColor("--focus", "#2c67a8");
    let shown: L.Layer[] = [];
    const planPoint = source.exact ?? source.area;
    addLocateControl(
      map,
      locateTexts(dialog, "Show where I am"),
      (position) => {
        if (signal.aborted) return;
        located = true;
        const me = { lat: position.coords.latitude, lng: position.coords.longitude };
        for (const layer of shown) layer.remove();
        shown = [
          L.circle([me.lat, me.lng], {
            radius: position.coords.accuracy,
            className: "map-me-accuracy",
            color: focusColour,
            weight: 1,
            fillOpacity: 0.12,
            interactive: false,
          }).addTo(map),
          L.circleMarker([me.lat, me.lng], {
            radius: 8,
            className: "map-me",
            color: "#ffffff",
            weight: 3,
            fillColor: focusColour,
            fillOpacity: 1,
            interactive: false,
          }).addTo(map),
        ];
        show(map, locateView(me, position.coords.accuracy, planPoint));
        if (status === null) return;
        // Emptied first and filled a moment later, so a second fix is announced again: the same
        // text written over itself is not a change a screen reader reports.
        status.textContent = "";
        setTimeout(() => {
          if (!signal.aborted) status.textContent = status.dataset.text ?? "";
        }, 100);
      },
      SHOW_ME_OPTIONS,
    );
  };
}

export function initPlanMaps(): void {
  window.addEventListener("pagehide", forgetRoutes);
  for (const element of document.querySelectorAll<HTMLElement>("[data-plan-map]")) {
    const source = readPlanSource(element);
    if (source === undefined) continue;
    element.hidden = false;

    const map = createMap(element, element, { scrollWheelZoom: false }).setView(
      [source.area.lat, source.area.lng],
      14,
    );
    tileLayer(element).addTo(map);
    void drawPlanLayers(map, source).then((bounds) => {
      if (bounds !== undefined) map.fitBounds(bounds, FIT_PADDING);
    });

    const template = element.nextElementSibling;
    if (template instanceof HTMLTemplateElement && template.dataset.mapDialog === "plan") {
      addExpandControl(map, template, element, planDialogSetup(source));
    }
  }
}
