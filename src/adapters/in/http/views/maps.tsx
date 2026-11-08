// Map markup for the bundled browser script (spec 3.9, decision D12). Every element starts hidden and
// only the script reveals it, so pages without JavaScript show no empty widgets.
import type { Translate } from "../../../i18n/i18n.ts";
import type { GeoPoint } from "../../../../domain/geo.ts";

/** Tile settings for the browser; undefined when maps are disabled. */
export interface MapSettings {
  tileUrl: string;
  attribution: string;
}

/** The bundled map script and stylesheet, served by the instance (spec 2). */
export function MapAssets() {
  return (
    <>
      <link rel="stylesheet" href="/static/build/map.css" />
      <script src="/static/build/map.js" defer></script>
    </>
  );
}

/** Place search, "Use my location" and the tap-to-pick map of the create and edit forms. */
export function MapTools({
  t,
  map,
  placeSearch,
}: {
  t: Translate;
  map: MapSettings | undefined;
  placeSearch: boolean;
}) {
  return (
    <div class="map-tools">
      {placeSearch && (
        <div
          class="place-search"
          data-place-search=""
          data-endpoint="/geocode"
          data-unavailable={t("map.searchUnavailable")}
          data-no-results={t("map.noResults")}
          hidden
        >
          <label for="place-search">{t("map.search")}</label>
          <div class="inline-input">
            <input id="place-search" type="search" maxlength={100} autocomplete="off" />
            <button type="button" class="secondary">
              {t("map.searchButton")}
            </button>
          </div>
          <p class="hint">{t("map.searchHint")}</p>
          <p class="hint" data-status="" role="status"></p>
          <ul class="place-results"></ul>
        </div>
      )}
      <button type="button" class="secondary" data-locate="" hidden>
        {t("map.locate")}
      </button>
      {map !== undefined && (
        <div
          class="map-picker"
          data-map-picker=""
          data-tile-url={map.tileUrl}
          data-attribution={map.attribution}
          data-zoom-in={t("map.zoomIn")}
          data-zoom-out={t("map.zoomOut")}
          hidden
        >
          <fieldset class="map-mode">
            <legend>{t("map.pickLegend")}</legend>
            <label class="choice">
              <input type="radio" name="mapMode" value="exact" checked />
              {t("map.pickExact")}
            </label>
            <label class="choice">
              <input type="radio" name="mapMode" value="area" />
              {t("map.pickArea")}
            </label>
          </fieldset>
          <div class="map" role="application" aria-label={t("map.pickLabel")}></div>
        </div>
      )}
    </div>
  );
}

/** The plan page map; exact start and route only for audiences allowed to see them (spec 3.6). */
export function PlanMap({
  t,
  map,
  area,
  exact,
  routeUrl,
}: {
  t: Translate;
  map: MapSettings;
  area: GeoPoint;
  exact: GeoPoint | undefined;
  routeUrl: string | undefined;
}) {
  return (
    <div
      class="map plan-map"
      data-plan-map=""
      data-tile-url={map.tileUrl}
      data-attribution={map.attribution}
      data-zoom-in={t("map.zoomIn")}
      data-zoom-out={t("map.zoomOut")}
      data-area-lat={String(area.lat)}
      data-area-lng={String(area.lng)}
      data-exact-lat={exact === undefined ? undefined : String(exact.lat)}
      data-exact-lng={exact === undefined ? undefined : String(exact.lng)}
      data-route-url={routeUrl}
      role="img"
      aria-label={t("map.planLabel")}
      hidden
    ></div>
  );
}
