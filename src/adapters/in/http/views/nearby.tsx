// Nearby (spec 7 Visibility and Nearby plans; decisions D35, I59): a search form sent with GET,
// so results can be linked, and the public plans it found. A place can be typed (with a
// geocoder), picked on the map or taken from the device; the map and "Use my location" need the
// map script, which rounds the point to the 0.02° grid before it enters the URL, and looks a
// typed place up through the place search endpoint, so the typed text stays out of the URL.
import type { Child } from "hono/jsx";
import type { NearbyItem, NearbyPlace, NearbySearch } from "../../../../application/nearby.ts";
import { ACTIVITY_TYPES } from "../../../../domain/activity.ts";
import {
  DEFAULT_RADIUS_KM,
  NEARBY_RADII_KM,
  type NearbyField,
  type NearbyFieldError,
  type NearbyInput,
} from "../../../../domain/nearby.ts";
import type { Units } from "../../../../domain/units.ts";
import type { Translate } from "../../../i18n/i18n.ts";
import { fieldErrorMessage, formatDistance, itemWhen } from "./format.ts";
import { Item } from "./item.tsx";
import { type MapSettings, NearbyMapDialog } from "./maps.tsx";
import { PlanMetrics } from "./plan-metrics.tsx";

export interface NearbyPageProps {
  t: Translate;
  language: string;
  units: Units;
  /** The query as sent, with the form's default days filled in. */
  values: NearbyInput;
  /** The days shown when none were chosen; others open the filters. */
  defaultDays: { from: string; to: string };
  /** Undefined while there is only the form. */
  result: NearbySearch | Exclude<NearbyPlace, { kind: "point" }> | undefined;
  /** Tile settings for the pick map; undefined when maps are disabled. */
  map: MapSettings | undefined;
  /** With a geocoder places can be typed; the token is for the place search endpoint. */
  placeSearch: { csrfToken: string } | undefined;
  /** Login is required for public plans and none is offered: nothing can be found. */
  nothingPublic: boolean;
}

export function NearbyPage(props: NearbyPageProps) {
  const { t, result } = props;
  const errors = result?.kind === "invalid" ? result.errors : [];
  return (
    <section class="nearby sectioned">
      <h1>{t("nearby.title")}</h1>
      {props.nothingPublic ? (
        <p>{t("nearby.nothingPublic")}</p>
      ) : (
        <>
          <p>{t("nearby.intro")}</p>
          {/* After a search the results come first, the form to change it below (phones). */}
          {result?.kind === "results" && (
            <Results {...props} items={result.items} truncated={result.truncated} />
          )}
          {result?.kind === "place_not_found" && (
            <p class="warning" role="status">
              {t("nearby.placeNotFound")}
            </p>
          )}
          {result?.kind === "place_unavailable" && (
            <p class="warning" role="status">
              {t("nearby.placeUnavailable")}
            </p>
          )}
          <SearchForm {...props} errors={errors} />
        </>
      )}
    </section>
  );
}

function SearchForm(props: NearbyPageProps & { errors: readonly NearbyFieldError[] }) {
  const { t, values, units, errors } = props;
  const errorFor = (field: NearbyField) => errors.find((error) => error.field === field);
  const unit = t(units === "imperial" ? "unit.mi" : "unit.km");
  const id = (name: NearbyField) => `nearby-${name}`;
  // As on the plan form: the error is named on the field and read with it.
  const invalid = (name: NearbyField) =>
    errorFor(name) === undefined
      ? {}
      : { "aria-invalid": "true", "aria-describedby": `${id(name)}-error` };
  const field = (name: NearbyField, label: string, control: Child, hint?: string) => {
    const error = errorFor(name);
    return (
      <div class={error === undefined ? "field" : "field field-invalid"}>
        <label for={id(name)}>{label}</label>
        {control}
        {hint !== undefined && <p class="hint">{hint}</p>}
        {error !== undefined && (
          <p class="error" id={`${id(name)}-error`}>
            {fieldErrorMessage(error.code, t)}
          </p>
        )}
      </div>
    );
  };
  const text = (name: NearbyField, attributes: Record<string, string | number> = {}) => (
    <input id={id(name)} name={name} value={values[name]} {...invalid(name)} {...attributes} />
  );
  return (
    <form
      method="get"
      action="/nearby"
      class="nearby-form"
      data-nearby=""
      data-geocode={props.placeSearch === undefined ? undefined : "/geocode"}
      data-csrf={props.placeSearch?.csrfToken}
    >
      <p class="hint">{t("nearby.placePrivacy")}</p>
      {props.placeSearch !== undefined &&
        field(
          "place",
          t("nearby.place"),
          text("place", {
            type: "search",
            maxlength: 100,
            autocomplete: "off",
            placeholder: t("placeholder.place"),
          }),
          t("nearby.placeHint"),
        )}
      {/* Set by the map or the device, already rounded; a typed place replaces them. */}
      <input type="hidden" name="lat" value={values.lat} />
      <input type="hidden" name="lng" value={values.lng} />
      {/* Shown by the script after a map tap or "Use my location" too. */}
      <p class="hint" data-nearby-point="" hidden={values.lat === "" || values.lng === ""}>
        {t("nearby.atPoint")}
      </p>
      {errorFor("lat") !== undefined && (
        <p class="error" role="alert">
          {fieldErrorMessage("coordinates_invalid", t)}
        </p>
      )}
      <div class="map-tools">
        <button
          type="button"
          class="secondary"
          data-nearby-locate=""
          data-locate-denied={t("map.locateDenied")}
          data-locate-unavailable={t("map.locateUnavailable")}
          hidden
        >
          {t("nearby.locate")}
        </button>
        {props.map !== undefined && (
          <>
            <div
              class="map nearby-map"
              data-nearby-map=""
              data-tile-url={props.map.tileUrl}
              data-attribution={props.map.attribution}
              data-zoom-in={t("map.zoomIn")}
              data-zoom-out={t("map.zoomOut")}
              role="application"
              aria-label={t("nearby.mapLabel")}
              hidden
            ></div>
            {/* The full-screen view (ADR 008): labels only, opened by the script alone. */}
            <template data-map-dialog="nearby" data-open-label={t("map.fullOpen")}>
              <NearbyMapDialog t={t} placeSearch={props.placeSearch !== undefined} />
            </template>
          </>
        )}
      </div>

      <button type="submit">{t("nearby.search")}</button>
      {/* Open while one is set or wrong; closed, the defaults apply. */}
      <details class="nearby-filters" open={filtersSet(values, props.defaultDays, errors)}>
        <summary>{t("nearby.filters")}</summary>
        {field(
          "radius",
          t("nearby.radius"),
          <select id="nearby-radius" name="radius" {...invalid("radius")}>
            {NEARBY_RADII_KM.map((km) => (
              <option
                value={String(km)}
                selected={(values.radius || String(DEFAULT_RADIUS_KM)) === String(km)}
              >
                {formatDistance(km * 1000, units, props.language, t)}
              </option>
            ))}
          </select>,
        )}
        <div class="field-row">
          {field("from", t("nearby.from"), text("from", { type: "date" }))}
          {field("to", t("nearby.to"), text("to", { type: "date" }))}
        </div>
        {field(
          "activity",
          t("nearby.activity"),
          <select id="nearby-activity" name="activity" {...invalid("activity")}>
            <option value="" selected={values.activity === ""}>
              {t("nearby.anyActivity")}
            </option>
            {ACTIVITY_TYPES.map((activity) => (
              <option value={activity} selected={values.activity === activity}>
                {t(`activity.${activity}`)}
              </option>
            ))}
          </select>,
        )}
        <fieldset>
          <legend>{t("nearby.distance", { unit })}</legend>
          <div class="field-row">
            {field(
              "distanceFrom",
              t("nearby.atLeast"),
              text("distanceFrom", {
                inputmode: "decimal",
                placeholder: t("placeholder.distanceFrom"),
              }),
            )}
            {field(
              "distanceTo",
              t("nearby.atMost"),
              text("distanceTo", {
                inputmode: "decimal",
                placeholder: t("placeholder.distanceTo"),
              }),
            )}
          </div>
        </fieldset>
        <fieldset>
          <legend>{t("nearby.pace")}</legend>
          <p class="hint">{t("nearby.paceHint")}</p>
          <div class="field-row">
            {field("paceFrom", t("nearby.atLeast"), text("paceFrom"))}
            {field("paceTo", t("nearby.atMost"), text("paceTo"))}
          </div>
        </fieldset>
        <button type="submit" class="secondary">
          {t("nearby.search")}
        </button>
      </details>
    </form>
  );
}

function Results(props: NearbyPageProps & { items: readonly NearbyItem[]; truncated: boolean }) {
  const { t, items, language, units } = props;
  return (
    <section class="nearby-results">
      <h2>{t("nearby.results", { count: items.length })}</h2>
      {props.truncated && <p class="hint">{t("nearby.truncated", { count: items.length })}</p>}
      {items.length === 0 ? (
        <p>{t("nearby.none")}</p>
      ) : (
        <ul class="items">
          {items.map((item) => (
            <Item
              href={`/p/${item.planId}`}
              title={item.title}
              meta={[
                t(`activity.${item.activity}`),
                itemWhen(t, { ...item, status: "active" }, language),
                item.areaLabel,
                // The viewer's point is on a 2 km grid: closer than that says nothing.
                item.awayKm < 2
                  ? t("nearby.close")
                  : t("nearby.away", {
                      distance: formatDistance(item.awayKm * 1000, units, language, t),
                    }),
              ].join(" · ")}
            >
              <PlanMetrics t={t} details={item} units={units} language={language} />
            </Item>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Whether any filter differs from the defaults, or is wrong. */
function filtersSet(
  values: NearbyInput,
  defaultDays: { from: string; to: string },
  errors: readonly NearbyFieldError[],
): boolean {
  const chosen: readonly NearbyField[] = [
    "activity",
    "distanceFrom",
    "distanceTo",
    "paceFrom",
    "paceTo",
  ];
  return (
    errors.some((error) => error.field !== "place" && error.field !== "lat") ||
    (values.radius !== "" && values.radius !== String(DEFAULT_RADIUS_KM)) ||
    values.from !== defaultDays.from ||
    values.to !== defaultDays.to ||
    chosen.some((field) => values[field].trim() !== "")
  );
}
