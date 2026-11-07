// Create-plan form (spec 5 feature 1). Works without JavaScript; field names are the
// PlanInput keys.
import type { Child } from "hono/jsx";
import type { Translate } from "../../../i18n/i18n.ts";
import { ACTIVITY_TYPES } from "../../../../domain/activity.ts";
import { DROP_POLICIES } from "../../../../domain/plan.ts";
import type { FieldError, PlanField, PlanInput } from "../../../../domain/plan-input.ts";
import { PLAN_LIMITS } from "../../../../domain/plan-input.ts";
import { defaultRetentionDays } from "../../../../domain/schedule.ts";
import { CSRF_FIELD } from "../csrf.ts";
import { fieldErrorMessage, retentionOptions } from "./format.ts";

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
        <select id={id("timeZone")} name="timeZone">
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
        <Field field="distanceKm" label={t("form.distance")}>
          {input("distanceKm", { inputmode: "decimal" })}
        </Field>
        <Field field="elevationGainM" label={t("form.elevation")}>
          {input("elevationGainM", { inputmode: "numeric" })}
        </Field>
      </div>

      <fieldset>
        <legend>{t("form.pace")}</legend>
        <p class="hint">{t("form.paceHint")}</p>
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

      <Field field="retentionDays" label={t("form.retention")}>
        <select id={id("retentionDays")} name="retentionDays">
          {retentionOptions(maxRetentionDays, retentionDays).map((days) => (
            <option value={days} selected={retentionDays === days}>
              {days === "1" ? t("form.retentionOne") : t("form.retentionMany", { days })}
            </option>
          ))}
        </select>
      </Field>

      <button type="submit">{submitLabel}</button>
    </form>
  );
}
