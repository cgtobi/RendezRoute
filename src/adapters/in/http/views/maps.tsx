// Map markup for the bundled browser script (spec 3.9, decision D12). Every element starts hidden and
// only the script reveals it, so pages without JavaScript show no empty widgets.
import type { Translate } from "../../../i18n/i18n.ts";
import type { Child } from "hono/jsx";
import type { GeoPoint } from "../../../../domain/geo.ts";

/** Tile settings for the browser; undefined when maps are disabled. */
export interface MapSettings {
  tileUrl: string;
  attribution: string;
  /** Where the form map opens when the operator set a place (decision D63); the plan map ignores it. */
  defaultCenter?: GeoPoint | undefined;
  defaultZoom: number;
}

/** The bundled map script and stylesheet, served by the instance (spec 2). */
export function MapAssets() {
  return (
    <>
      <link rel="stylesheet" href="/static/build/map.css" />
      {/* A module for its own scope: see the app.js tag in layout.tsx. */}
      <script src="/static/build/map.js" type="module"></script>
    </>
  );
}

/** The switch between setting the area point and the exact start on the pick map. */
export function ModeSwitch({ t }: { t: Translate }) {
  return (
    <fieldset class="mode-switch">
      <legend class="visually-hidden">{t("map.pickLegend")}</legend>
      <label>
        <input type="radio" name="mapMode" value="area" checked />
        <span>{t("map.modeArea")}</span>
      </label>
      <label>
        <input type="radio" name="mapMode" value="exact" />
        <span>{t("map.modeExact")}</span>
      </label>
    </fieldset>
  );
}

/**
 * The place search merged into the area field (decision D77): the area input, with the magnifier
 * button on its line, and the status and results lines under it. Typing sends nothing; Enter or the
 * button sends the typed text to the place search (src/client/place-search.ts). The button and the
 * hint are revealed by the script, so without JavaScript the area stays a plain text field.
 */
export function AreaSearch({
  t,
  control,
  requiredHint,
}: {
  t: Translate;
  /** The area text input (it keeps its own id, name and aria attributes). */
  control: Child;
  /** The "Required" hint that belongs to the control; a sibling of the row, so CSS can show it. */
  requiredHint: Child;
}) {
  return (
    <div
      class="place-search"
      data-place-search=""
      data-endpoint="/geocode"
      data-placeholder={t("placeholder.areaSearch")}
      data-unavailable={t("map.searchUnavailable")}
      data-no-results={t("map.noResults")}
    >
      <div class="inline-input line-action">
        {control}
        <button type="button" class="line-action-button" hidden>
          <span class="icon icon-search" aria-hidden="true"></span>
          <span class="visually-hidden">{t("map.searchButton")}</span>
        </button>
      </div>
      {requiredHint}
      <p class="hint" data-search-hint="" hidden>
        {t("map.searchHint")}
      </p>
      <p class="hint" data-status="" role="status"></p>
      <ul class="place-results"></ul>
    </div>
  );
}

/** The tap-to-pick map (with its mode switch) of the create and edit forms. */
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
      {map !== undefined && (
        <div
          class="map-picker"
          data-map-picker=""
          data-tile-url={map.tileUrl}
          data-attribution={map.attribution}
          data-default-center={
            map.defaultCenter === undefined
              ? undefined
              : `${map.defaultCenter.lat},${map.defaultCenter.lng}`
          }
          data-default-zoom={map.defaultCenter === undefined ? undefined : String(map.defaultZoom)}
          data-zoom-in={t("map.zoomIn")}
          data-zoom-out={t("map.zoomOut")}
          data-locate-title={t("map.findMe")}
          data-locate-denied={t("map.locateDenied")}
          data-locate-unavailable={t("map.locateUnavailable")}
          data-suggest-endpoint={placeSearch ? "/geocode/reverse" : undefined}
          data-describe-endpoint={placeSearch ? "/geocode/describe" : undefined}
          hidden
        >
          <div class="map" role="application" aria-label={t("map.pickLabel")}></div>
          <ModeSwitch t={t} />
          <p
            class="hint map-caption"
            data-map-caption=""
            data-caption-area={t("map.captionArea")}
            data-caption-exact={t("map.captionExact")}
            data-caption-area-follows={t("map.captionAreaFollows")}
            aria-live="polite"
          >
            {t("map.captionArea")}
          </p>
          <div class="point-readout" data-area-readout="" hidden>
            <p data-area-set="" hidden>
              <span class="readout-text">{t("map.areaSet")}</span>
              <button type="button" class="icon-button" data-area-remove="">
                <span class="icon icon-close" aria-hidden="true"></span>
                <span class="visually-hidden">{t("map.areaRemove")}</span>
              </button>
            </p>
            <p data-area-none="" tabindex={-1}>
              {t("map.areaNone")}
            </p>
          </div>
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
