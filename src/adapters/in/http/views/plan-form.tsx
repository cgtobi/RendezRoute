// Create-plan form (spec 5 feature 1). Works without JavaScript; field names are the
// PlanInput keys.
import type { Child } from "hono/jsx";
import type { Translate } from "../../../i18n/i18n.ts";
import { ACTIVITY_TYPES } from "../../../../domain/activity.ts";
import { DROP_POLICIES, JOIN_MODES } from "../../../../domain/plan.ts";
import type { FieldError, PlanField, PlanInput } from "../../../../domain/plan-input.ts";
import { PLAN_LIMITS } from "../../../../domain/plan-input.ts";
import { defaultRecapWindow, defaultRetentionDays } from "../../../../domain/schedule.ts";
import { CSRF_FIELD } from "../csrf.ts";
import { fieldErrorMessage, retentionOptions } from "./format.ts";
import { MapTools, type MapSettings } from "./maps.tsx";
import { RecapWindowSelect } from "./recap.tsx";
import { RouteTrimField } from "./route-trim.tsx";
import type { Units } from "../../../../domain/units.ts";

const COLOR_PRESETS = [
  "#2E5BFF",
  "#0F9D58",
  "#D93025",
  "#8E24AA",
  "#F9AB00",
  "#00897B",
  "#FF7A45",
  "#3C4043",
];

export interface PlanFormProps {
  t: Translate;
  values: PlanInput;
  errors: readonly FieldError[];
  csrfToken: string;
  /** One-time value for creating; editing needs none (decision I9). */
  nonce: string | undefined;
  timeZones: readonly string[];
  maxRetentionDays: number;
  action: string;
  heading: string;
  submitLabel: string;
  /** Offer the optional GPX file field (create form only; the host page has its own route section). */
  withGpx: boolean;
  /** Tile settings for the pick map; undefined when maps are disabled. */
  map: MapSettings | undefined;
  /** Offer place search (geocoder enabled). */
  placeSearch: boolean;
  /** The submitted "hide start and end" choice, kept when the form shows errors. */
  routeTrim: string;
  /** Distance, elevation and pace are entered in these units (decision P5). */
  units: Units;
  /** The server's default zone, which the app script may replace with the poster's (decision P6). */
  detectZoneFrom?: string | undefined;
  /** Pending requests that switching to open mode would accept; asks first (spec 3.4). */
  confirmAcceptPending?: number | undefined;
}

export function PlanForm({
  t,
  values,
  errors,
  csrfToken,
  nonce,
  timeZones,
  maxRetentionDays,
  action,
  heading,
  submitLabel,
  withGpx,
  map,
  placeSearch,
  routeTrim,
  units,
  detectZoneFrom,
  confirmAcceptPending,
}: PlanFormProps) {
  const errorFor = (field: PlanField) => errors.find((error) => error.field === field);
  const id = (field: PlanField) => `field-${field}`;

  const Field = ({
    field,
    label,
    hint,
    children,
  }: {
    field: PlanField;
    label: string;
    hint?: string;
    children: Child;
  }) => {
    const error = errorFor(field);
    return (
      <div class={error === undefined ? "field" : "field field-invalid"}>
        <label for={id(field)}>{label}</label>
        {children}
        {hint !== undefined && <p class="hint">{hint}</p>}
        {error !== undefined && (
          <p class="error" id={`${id(field)}-error`}>
            {fieldErrorMessage(error.code, t)}
          </p>
        )}
      </div>
    );
  };

  const input = (field: PlanField, attributes: Record<string, string | number | boolean> = {}) => (
    <input
      id={id(field)}
      name={field}
      value={values[field]}
      aria-invalid={errorFor(field) !== undefined ? "true" : undefined}
      aria-describedby={errorFor(field) !== undefined ? `${id(field)}-error` : undefined}
      {...attributes}
    />
  );

  const retentionDays =
    values.retentionDays === ""
      ? String(defaultRetentionDays(maxRetentionDays))
      : values.retentionDays;

  return (
    <form
      method="post"
      action={action}
      class="plan-form"
      enctype={withGpx ? "multipart/form-data" : undefined}
    >
      <h1>{heading}</h1>
      {errors.length > 0 && (
        <p class="error" role="alert">
          {t("form.errors")}
        </p>
      )}
      <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
      {nonce !== undefined && <input type="hidden" name="nonce" value={nonce} />}

      <Field field="posterName" label={t("form.posterName")} hint={t("form.posterNameHint")}>
        {input("posterName", {
          required: true,
          maxlength: PLAN_LIMITS.posterName,
          autocomplete: "nickname",
        })}
      </Field>

      <Field field="activity" label={t("form.activity")}>
        <select id={id("activity")} name="activity">
          {ACTIVITY_TYPES.map((activity) => (
            <option value={activity} selected={values.activity === activity}>
              {t(`activity.${activity}`)}
            </option>
          ))}
        </select>
      </Field>

      <Field field="title" label={t("form.title")}>
        {input("title", { required: true, maxlength: PLAN_LIMITS.title })}
      </Field>

      <div class="field-row">
        <Field field="date" label={t("form.date")}>
          {input("date", { type: "date", required: true })}
        </Field>
        <Field field="time" label={t("form.time")}>
          {input("time", { type: "time", required: true })}
        </Field>
      </div>

      <Field field="timeZone" label={t("form.timeZone")}>
        <select id={id("timeZone")} name="timeZone" data-detect-zone={detectZoneFrom}>
          {timeZones.map((zone) => (
            <option value={zone} selected={values.timeZone === zone}>
              {zone}
            </option>
          ))}
        </select>
      </Field>

      <Field
        field="areaLabel"
        label={t("form.areaLabel")}
        hint={`${t("form.areaLabelHint")} ${t("form.publicHint")}`}
      >
        {input("areaLabel", { required: true, maxlength: PLAN_LIMITS.areaLabel })}
      </Field>

      <MapTools t={t} map={map} placeSearch={placeSearch} />

      <details open={values.areaLat !== "" || values.areaLng !== ""}>
        <summary>{t("form.areaCoordinates")}</summary>
        <p class="hint">{t("form.areaCoordinatesHint")}</p>
        <div class="field-row">
          <Field field="areaLat" label={t("form.latitude")}>
            {input("areaLat", { inputmode: "decimal" })}
          </Field>
          <Field field="areaLng" label={t("form.longitude")}>
            {input("areaLng", { inputmode: "decimal" })}
          </Field>
        </div>
      </details>

      <fieldset>
        <legend>{t("form.exactStart")}</legend>
        <p class="hint">{t("form.exactStartHint")}</p>
        <p class="hint">{t("form.openModeWarning")}</p>
        <Field field="exactDescription" label={t("form.exactDescription")}>
          {input("exactDescription", { maxlength: 200 })}
        </Field>
        <details open={values.exactLat !== "" || values.exactLng !== ""}>
          <summary>{t("form.coordinates")}</summary>
          <div class="field-row">
            <Field field="exactLat" label={t("form.latitude")}>
              {input("exactLat", { inputmode: "decimal" })}
            </Field>
            <Field field="exactLng" label={t("form.longitude")}>
              {input("exactLng", { inputmode: "decimal" })}
            </Field>
          </div>
        </details>
      </fieldset>

      <div class="field-row">
        <Field
          field="distanceKm"
          label={t("form.distance", { unit: t(units === "imperial" ? "unit.mi" : "unit.km") })}
        >
          {input("distanceKm", { inputmode: "decimal" })}
        </Field>
        <Field
          field="elevationGainM"
          label={t("form.elevation", { unit: t(units === "imperial" ? "unit.ft" : "unit.m") })}
        >
          {input("elevationGainM", { inputmode: "numeric" })}
        </Field>
      </div>

      <fieldset>
        <legend>{t("form.pace")}</legend>
        <p class="hint">{t(units === "imperial" ? "form.paceHintImperial" : "form.paceHint")}</p>
        <div class="field-row">
          <Field field="paceFrom" label={t("form.paceFrom")}>
            {input("paceFrom")}
          </Field>
          <Field field="paceTo" label={t("form.paceTo")}>
            {input("paceTo")}
          </Field>
        </div>
      </fieldset>

      <fieldset>
        <legend>{t("form.dropPolicy")}</legend>
        {DROP_POLICIES.map((policy) => (
          <label class="choice">
            <input
              type="radio"
              name="dropPolicy"
              value={policy}
              checked={values.dropPolicy === policy}
            />
            {t(`drop.${policy}`)}
          </label>
        ))}
        {errorFor("dropPolicy") !== undefined && (
          <p class="error">{fieldErrorMessage("choice_invalid", t)}</p>
        )}
      </fieldset>

      <fieldset>
        <legend>{t("form.joinMode")}</legend>
        <p class="hint">{t("form.joinModeHint")}</p>
        {JOIN_MODES.map((mode) => (
          <label class="choice">
            <input
              type="radio"
              name="joinMode"
              value={mode}
              checked={(values.joinMode === "" ? "open" : values.joinMode) === mode}
            />
            {t(mode === "open" ? "form.joinOpen" : "form.joinApproval")}
          </label>
        ))}
        {errorFor("joinMode") !== undefined && (
          <p class="error">{fieldErrorMessage("choice_invalid", t)}</p>
        )}
      </fieldset>

      <Field field="note" label={t("form.note")} hint={t("form.publicHint")}>
        <textarea id={id("note")} name="note" rows={4} maxlength={PLAN_LIMITS.note}>
          {values.note}
        </textarea>
      </Field>

      <fieldset>
        <legend>{t("form.colors")}</legend>
        <datalist id="color-presets">
          {COLOR_PRESETS.map((color) => (
            <option value={color} />
          ))}
        </datalist>
        <div class="field-row">
          <Field field="primaryColor" label={t("form.primaryColor")}>
            {input("primaryColor", { type: "color", list: "color-presets" })}
          </Field>
          <Field field="secondaryColor" label={t("form.secondaryColor")}>
            {input("secondaryColor", { type: "color", list: "color-presets" })}
          </Field>
        </div>
      </fieldset>

      {withGpx && (
        <div class={errors.some((e) => e.field === "gpx") ? "field field-invalid" : "field"}>
          <label for="field-gpx">{t("form.gpx")}</label>
          <input id="field-gpx" type="file" name="gpx" accept=".gpx,application/gpx+xml" />
          <p class="hint">{t("form.gpxHint")}</p>
          {errors
            .filter((e) => e.field === "gpx")
            .map((e) => (
              <p class="error">{fieldErrorMessage(e.code, t)}</p>
            ))}
        </div>
      )}
      {withGpx && <RouteTrimField t={t} id="field-gpxTrim" selected={routeTrim} units={units} />}

      <Field field="retentionDays" label={t("form.retention")}>
        <select id={id("retentionDays")} name="retentionDays">
          {retentionOptions(maxRetentionDays, retentionDays).map((days) => (
            <option value={days} selected={retentionDays === days}>
              {t("form.retentionDays", { count: Number(days) })}
            </option>
          ))}
        </select>
      </Field>

      <Field field="recapWindow" label={t("form.recapWindow")} hint={t("form.recapWindowHint")}>
        <RecapWindowSelect
          t={t}
          id={id("recapWindow")}
          selected={values.recapWindow || defaultRecapWindow(Number(retentionDays))}
        />
      </Field>

      {confirmAcceptPending !== undefined && (
        <>
          <input type="hidden" name="confirmAcceptPending" value={String(confirmAcceptPending)} />
          <p class="warning" role="alert">
            {t("host.acceptPendingWarning", { count: confirmAcceptPending })}
          </p>
        </>
      )}
      <button type="submit">
        {confirmAcceptPending === undefined ? submitLabel : t("host.acceptPendingConfirm")}
      </button>
    </form>
  );
}
