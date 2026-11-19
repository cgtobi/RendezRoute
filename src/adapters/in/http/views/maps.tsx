// Map markup for the bundled browser script (spec 3.9, decision D12). Every element starts hidden and
// only the script reveals it, so pages without JavaScript show no empty widgets.
import type { Translate } from "../../../i18n/i18n.ts";
import type { Child } from "hono/jsx";
import type { GeoPoint } from "../../../../domain/geo.ts";
import { assetUrl } from "../asset-url.ts";

/** Tile settings for the browser; undefined when maps are disabled. */
export interface MapSettings {
  tileUrl: string;
  attribution: string;
  /** Where the form map opens when the operator set a place (decision D63); the plan map ignores it. */
  defaultCenter?: GeoPoint | undefined;
  defaultZoom: number;
}

/** The bundled map script and stylesheet, served by the instance (spec 2). */
export function MapAssets({ pathBase }: { pathBase: string }) {
  return (
    <>
      <link rel="stylesheet" href={assetUrl(pathBase, "build/map.css")} />
      {/* A module for its own scope: see the app.js tag in layout.tsx. */}
      <script src={assetUrl(pathBase, "build/map.js")} type="module"></script>
    </>
  );
}

/**
 * The switch between setting the area point and the exact start on the pick map. The page's radios
 * are `mapMode`; the full-screen view's are `mapModeFull` (ADR 008), a group of their own outside
 * the form. With `idPrefix` the radios get ids (`PREFIX-mode-area`, `PREFIX-mode-exact`).
 */
export function ModeSwitch({
  t,
  name = "mapMode",
  idPrefix,
}: {
  t: Translate;
  name?: string;
  idPrefix?: string | undefined;
}) {
  const id = (mode: string) => (idPrefix === undefined ? undefined : `${idPrefix}-mode-${mode}`);
  return (
    <fieldset class="mode-switch">
      <legend class="visually-hidden">{t("map.pickLegend")}</legend>
      <label>
        <input type="radio" id={id("area")} name={name} value="area" checked />
        <span>{t("map.modeArea")}</span>
      </label>
      <label>
        <input type="radio" id={id("exact")} name={name} value="exact" />
        <span>{t("map.modeExact")}</span>
      </label>
    </fieldset>
  );
}

/** The form map's caption: one text per mode, swapped by the script (src/client/pick-rule.ts). */
function MapCaption({ t }: { t: Translate }) {
  return (
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
  searchVisible = false,
}: {
  t: Translate;
  /** The area text input (it keeps its own id, name and aria attributes). */
  control: Child;
  /** The "Required" hint that belongs to the control; a sibling of the row, so CSS can show it. */
  requiredHint: Child;
  /** Show the search button without the script (the style guide shows the revealed state). */
  searchVisible?: boolean;
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
        <button type="button" class="line-action-button" hidden={!searchVisible}>
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
          <MapCaption t={t} />
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
          {/* The full-screen view (ADR 008): labels only, opened by the script alone. */}
          <template data-map-dialog="pick" data-open-label={t("map.fullOpen")}>
            <PickMapDialog t={t} />
          </template>
        </div>
      )}
    </div>
  );
}

/** The three full-screen maps (ADR 008). */
export type MapDialogKind = "plan" | "pick" | "nearby";

/**
 * The full-screen map's frame (ADR 008): a head, the stage that holds the map, and an optional
 * foot. As a `<dialog>` it lives in a `<template>` next to the page map and the script clones it
 * into the body; with `sample` it is a plain `div` for the style guide (no dialog, no name, no
 * script data), so the real head, key and foot can be shown without Leaflet.
 */
export function MapDialogFrame({
  kind,
  label,
  labelledBy,
  closeLabel,
  head,
  stage,
  foot,
  data = {},
  sample = false,
}: {
  kind: MapDialogKind;
  /** The dialog's name as text (form and Nearby dialogs); give this or `labelledBy`. */
  label?: string | undefined;
  /** The id of the dialog's heading (the plan dialog). */
  labelledBy?: string | undefined;
  /** The Close icon's name; the script builds the icon. */
  closeLabel: string;
  head: Child;
  stage: Child;
  foot?: Child;
  /** Further `data-*` attributes the script reads (e.g. the locate texts). */
  data?: Readonly<Record<`data-${string}`, string>>;
  sample?: boolean;
}) {
  const parts = (
    <>
      <div class="map-dialog-head">{head}</div>
      <div class="map-dialog-stage">{stage}</div>
      {foot !== undefined && <div class="map-dialog-foot">{foot}</div>}
    </>
  );
  if (sample) return <div class={`map-dialog map-dialog-${kind} sg-map-dialog`}>{parts}</div>;
  return (
    <dialog
      class={`map-dialog map-dialog-${kind}`}
      aria-label={label}
      aria-labelledby={labelledBy}
      data-close-label={closeLabel}
      {...data}
    >
      {parts}
    </dialog>
  );
}

/**
 * The plan's full-screen map (ADR 008): the plan's title and time, the map, its key and the hidden
 * status line of "Show where I am". The key lists the exact start and the route only when the page
 * map has them (`exact`, `route`: the same gate as the page map's data attributes, spec 3.6). No
 * coordinate, route address or other data is in here: the script reads those from the page map.
 */
export function PlanMapDialog({
  t,
  title,
  when,
  exact,
  route,
  idPrefix = "map-dialog",
  sample = false,
}: {
  t: Translate;
  title: string;
  /** The start, with the plan's time zone as the plan page shows it. */
  when: Child;
  exact: boolean;
  route: boolean;
  idPrefix?: string;
  sample?: boolean;
}) {
  const titleId = `${idPrefix}-title`;
  const legend = (
    <ul class="map-dialog-legend" data-map-legend="" aria-label={t("map.legend")}>
      <li data-legend="area">
        <span class="map-key map-key-area" aria-hidden="true"></span>
        {t("map.modeArea")}
      </li>
      {exact && (
        <li data-legend="exact">
          <span class="map-key map-key-exact" aria-hidden="true"></span>
          {t("map.modeExact")}
        </li>
      )}
      {route && (
        <li data-legend="route">
          <span class="map-key map-key-route" aria-hidden="true"></span>
          {t("plan.route")}
        </li>
      )}
    </ul>
  );
  return (
    <MapDialogFrame
      kind="plan"
      labelledBy={titleId}
      closeLabel={t("map.fullClose")}
      sample={sample}
      data={{
        "data-locate-title": t("map.showMe"),
        "data-locate-denied": t("map.locateDenied"),
        "data-locate-unavailable": t("map.locateUnavailable"),
      }}
      head={
        <>
          <h2 class="map-dialog-title" id={titleId}>
            {title}
          </h2>
          <p class="map-dialog-when">{when}</p>
          <p
            class="visually-hidden"
            role="status"
            data-map-status=""
            data-text={t("map.showMeDone")}
          ></p>
        </>
      }
      stage={
        <>
          {!sample && (
            <div
              class="map map-dialog-map"
              tabindex={0}
              autofocus
              role="region"
              aria-label={t("map.planLabel")}
            ></div>
          )}
          {legend}
        </>
      }
    />
  );
}

/** The full-screen view's Done: closes it (src/client/map-dialog.ts), first in the foot. */
function DoneButton({ t }: { t: Translate }) {
  return (
    <button type="button" class="map-dialog-done" data-map-dialog-close="">
      {t("layout.done")}
    </button>
  );
}

/**
 * The form map's full-screen view (ADR 008): its own mode switch (`mapModeFull`, outside the form,
 * mirrored to the page's), the caption, the map, Done, the line naming the point that is set and
 * "Remove point" for it. No control here has a form name but the mode radios, and nothing here
 * holds a coordinate: the script writes the page form's fields. With `sample` (style guide) the
 * exact start shows as set, with its Remove point.
 */
export function PickMapDialog({
  t,
  idPrefix = "map-dialog",
  sample = false,
}: {
  t: Translate;
  idPrefix?: string;
  sample?: boolean;
}) {
  return (
    <MapDialogFrame
      kind="pick"
      label={t("map.fullLabel")}
      closeLabel={t("map.fullClose")}
      sample={sample}
      head={
        <>
          <ModeSwitch t={t} name="mapModeFull" idPrefix={idPrefix} />
          <MapCaption t={t} />
        </>
      }
      stage={
        !sample && (
          <div
            class="map map-dialog-map"
            tabindex={0}
            autofocus
            role="application"
            aria-label={t("map.pickLabel")}
          ></div>
        )
      }
      foot={
        <>
          <DoneButton t={t} />
          <p class="map-dialog-status" data-point-status="" tabindex={-1} aria-live="polite">
            <span data-status="exact" hidden={!sample}>
              {t("map.fullExactSet")}
            </span>
            <span data-status="area" hidden>
              {t("map.fullAreaSet")}
            </span>
            <span data-status="none" hidden={sample}>
              {t("map.fullNone")}
            </span>
          </p>
          <button type="button" class="map-dialog-remove" data-point-remove="" hidden={!sample}>
            {t("map.removePoint")}
          </button>
        </>
      }
    />
  );
}

/**
 * Nearby's full-screen view (ADR 008): with a geocoder a place search of its own (no form name,
 * never submitting the form: the script looks the place up and sets the point), the caption, the
 * map, Done, the "Around the spot you chose" line and "Use my location" (revealed by the script).
 * With `sample` (style guide) the hidden parts show.
 */
export function NearbyMapDialog({
  t,
  placeSearch,
  idPrefix = "map-dialog",
  sample = false,
}: {
  t: Translate;
  /** With a geocoder: the place search line. */
  placeSearch: boolean;
  idPrefix?: string;
  sample?: boolean;
}) {
  const placeId = `${idPrefix}-place`;
  return (
    <MapDialogFrame
      kind="nearby"
      label={t("map.fullLabel")}
      closeLabel={t("map.fullClose")}
      sample={sample}
      head={
        <>
          {placeSearch && (
            <div class="map-dialog-search" data-map-dialog-search="">
              <label class="visually-hidden" for={placeId}>
                {t("nearby.place")}
              </label>
              <div class="inline-input line-action">
                <input
                  id={placeId}
                  type="search"
                  autocomplete="off"
                  maxlength={100}
                  enterkeyhint="search"
                  placeholder={t("placeholder.place")}
                />
                <button type="button" class="line-action-button">
                  <span class="icon icon-search" aria-hidden="true"></span>
                  <span class="visually-hidden">{t("map.searchButton")}</span>
                </button>
              </div>
              <p
                class="hint"
                role="status"
                data-search-status=""
                data-no-results={t("map.noResults")}
                data-unavailable={t("map.searchUnavailable")}
              ></p>
            </div>
          )}
          <p class="hint map-caption">{t("nearby.mapLabel")}</p>
        </>
      }
      stage={
        !sample && (
          <div
            class="map map-dialog-map"
            tabindex={0}
            autofocus
            role="application"
            aria-label={t("nearby.mapLabel")}
          ></div>
        )
      }
      foot={
        <>
          <DoneButton t={t} />
          <p class="map-dialog-status" data-nearby-status="" hidden={!sample}>
            {t("nearby.atPoint")}
          </p>
          <button
            type="button"
            class="secondary"
            data-dialog-locate=""
            data-locate-denied={sample ? undefined : t("map.locateDenied")}
            data-locate-unavailable={sample ? undefined : t("map.locateUnavailable")}
            hidden={!sample}
          >
            {t("nearby.locate")}
          </button>
        </>
      }
    />
  );
}

/**
 * The plan page map; exact start and route only for audiences allowed to see them (spec 3.6).
 * Next to it the full-screen view's template (ADR 008), which the script alone opens.
 */
export function PlanMap({
  t,
  map,
  area,
  exact,
  routeUrl,
  title,
  when,
}: {
  t: Translate;
  map: MapSettings;
  area: GeoPoint;
  exact: GeoPoint | undefined;
  routeUrl: string | undefined;
  /** The plan's title and formatted start (with its time zone), for the full-screen view's head. */
  title: string;
  when: Child;
}) {
  return (
    <>
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
        role="region"
        aria-label={t("map.planLabel")}
        hidden
      ></div>
      <template data-map-dialog="plan" data-open-label={t("map.fullOpen")}>
        <PlanMapDialog
          t={t}
          title={title}
          when={when}
          exact={exact !== undefined}
          route={routeUrl !== undefined}
        />
      </template>
    </>
  );
}
