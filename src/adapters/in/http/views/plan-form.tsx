// Create-plan form (spec 5 feature 1). Works without JavaScript; field names are the
// PlanInput keys.
import type { Child } from "hono/jsx";
import type { Translate } from "../../../i18n/i18n.ts";
import { ACTIVITY_TYPES, type ActivityType, paceStyleFor } from "../../../../domain/activity.ts";
import { DEFAULT_COLORS } from "../../../../domain/color.ts";
import {
  CHOOSABLE_VISIBILITIES,
  DROP_POLICIES,
  JOIN_MODES,
  SHARE_BUTTONS,
} from "../../../../domain/plan.ts";
import type { FieldError, PlanField, PlanInput } from "../../../../domain/plan-input.ts";
import { PLAN_LIMITS, SHARE_BUTTON_FIELDS } from "../../../../domain/plan-input.ts";
import {
  defaultRecapWindow,
  defaultRetentionDays,
  RECAP_WINDOWS,
  recapWindowDays,
} from "../../../../domain/schedule.ts";
import { CSRF_FIELD } from "../csrf.ts";
import { fieldErrorMessage, retentionOptions } from "./format.ts";
import { MapTools, type MapSettings } from "./maps.tsx";
import { RecapWindowSelect } from "./recap.tsx";
import { RouteTrimField } from "./route-trim.tsx";
import { TemplateOptions } from "./templates.tsx";
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

/** Seconds in the start time's step: the picker offers quarter hours. */
const TIME_STEP_SECONDS = 900;

/**
 * Whether a start time ("HH:MM") sits on the 15-minute grid. An empty value counts as on it (a new
 * form); text that is not a time does not, so the step is left off and nothing is made worse.
 * Browsers refuse to submit a time off the step grid, so the form only asks for the step when the
 * stored or submitted time already fits it. The server accepts any minute.
 */
export function onQuarterHour(time: string): boolean {
  return time === "" || /^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/.test(time);
}

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
  /** Editing a template: no date and no template options (spec 3.10). */
  forTemplate?: boolean;
  /** Shown above the form, e.g. why a template needs changes before repeating. */
  notice?: string | undefined;
  /**
   * Who can find the plan (spec 3.3, decision D35): whether public may be chosen, and where to
   * log in when only accounts may. When public can never be chosen here, the choice is not shown
   * and the plan stays link-only.
   */
  visibility: VisibilityChoice;
}

export interface VisibilityChoice {
  publicAllowed: boolean;
  /** Where to log in; undefined when the instance offers no login. */
  loginHref: string | undefined;
  /** Whether the plan's owner is an account (for a new plan: this device's): only accounts have profiles, which followers need. */
  hasAccount: boolean;
  /** Undefined while federation is off: followers is not offered (decision D37). */
  followers: { allowed: boolean } | undefined;
  /** The owner's full handle while it has a profile, e.g. "@anna@runs.example.org". */
  sharedBy: string | undefined;
  /** Whether public plans are listed in Nearby, which the public option then says. */
  nearby: boolean;
  /** A stored plan in the fediverse, or withdrawn from it for good (decision D39). */
  fediverse?: "shared" | "withdrawn" | undefined;
}

type Choosable = (typeof CHOOSABLE_VISIBILITIES)[number];

function isActivity(value: string): value is ActivityType {
  return (ACTIVITY_TYPES as readonly string[]).includes(value);
}

/** One group of optional fields: title, a one-line value summary and a chevron (decision D61). */
function Fold({
  title,
  value,
  open,
  strong = false,
  warning = false,
  kind,
  summaries,
  children,
}: {
  title: string;
  value: string;
  open: boolean;
  strong?: boolean;
  warning?: boolean;
  /** Which summary the browser script keeps in step with the fields, with every variant text. */
  kind?: "who" | "exact";
  summaries?: Record<string, string>;
  children: Child;
}) {
  const classes = [
    "fold",
    strong ? "fold-strong" : undefined,
    warning ? "fold-warning" : undefined,
  ];
  return (
    <details
      class={classes.filter(Boolean).join(" ")}
      open={open}
      data-summary-kind={kind}
      data-summaries={summaries === undefined ? undefined : JSON.stringify(summaries)}
    >
      <summary>
        <span class="fold-text">
          <span class="fold-title">{title}</span>
          <span class="visually-hidden">, </span>
          <span class="fold-value">{value}</span>
        </span>
      </summary>
      <div class="fold-body">{children}</div>
    </details>
  );
}

/** Which choices of "Who can find this plan" exist, and whether each may be made. */
function visibilityAvailability(choice: VisibilityChoice, value: string) {
  const options: Record<Choosable, { shown: boolean; allowed: boolean }> = {
    link: { shown: true, allowed: true },
    followers: {
      shown: choice.followers !== undefined,
      allowed: choice.followers?.allowed === true,
    },
    public: {
      // Public that nothing would find, and logging in would not help: not offered (I59).
      shown: choice.publicAllowed || choice.loginHref !== undefined,
      allowed: choice.publicAllowed,
    },
  };
  const shown = CHOOSABLE_VISIBILITIES.filter((visibility) => options[visibility].shown);
  const chosen = shown.find((visibility) => visibility === value && options[visibility].allowed);
  return { options, shown, chosen };
}

/** What the visibility fieldset will show as chosen; link-only where it is not offered. */
function effectiveVisibilityOf(choice: VisibilityChoice, value: string): Choosable {
  const { shown, chosen } = visibilityAvailability(choice, value);
  return shown.length === 1 ? "link" : (chosen ?? "link");
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
  forTemplate = false,
  notice,
  visibility,
}: PlanFormProps) {
  const errorFor = (field: PlanField) => errors.find((error) => error.field === field);
  const id = (field: PlanField) => `field-${field}`;
  const titleError = errorFor("title");

  const Field = ({
    field,
    label,
    hint,
    class: extraClass,
    children,
  }: {
    field: PlanField;
    label: string;
    hint?: string;
    class?: string;
    children: Child;
  }) => {
    const error = errorFor(field);
    const classes = ["field", extraClass, error === undefined ? undefined : "field-invalid"];
    return (
      <div class={classes.filter(Boolean).join(" ")}>
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

  const hasError = (...fields: readonly (PlanField | "gpx")[]) =>
    errors.some((error) => fields.includes(error.field));

  const recapWindow = values.recapWindow || defaultRecapWindow(Number(retentionDays));
  const joinMode = values.joinMode === "approval" ? "approval" : "open";
  const effectiveVisibility =
    visibility === undefined ? "link" : effectiveVisibilityOf(visibility, values.visibility);
  const exactSummaries = {
    "open:none": t("fold.exactNoneOpen"),
    "open:set": t("fold.exactSetOpen"),
    "approval:none": t("fold.exactNone"),
    "approval:set": t("fold.exactSet"),
  };
  const exactSet =
    values.exactDescription.trim() !== "" ||
    values.exactLat.trim() !== "" ||
    values.exactLng.trim() !== "";
  const shownZone = timeZones.includes(values.timeZone) ? values.timeZone : (timeZones[0] ?? "");
  const hostNameCollapsed = values.posterName.trim() !== "" && errorFor("posterName") === undefined;

  const hostNameField = (
    <Field field="posterName" label={t("form.posterName")} hint={t("form.posterNameHint")}>
      {input("posterName", {
        required: true,
        maxlength: PLAN_LIMITS.posterName,
        autocomplete: "nickname",
      })}
    </Field>
  );

  const unitLabel = t(
    isActivity(values.activity) && paceStyleFor(values.activity) === "speed"
      ? units === "imperial"
        ? "unit.mph"
        : "unit.kmh"
      : units === "imperial"
        ? "unit.minPerMi"
        : "unit.minPerKm",
  );
  const routeParts = [
    withGpx ? t("fold.routeNone") : undefined,
    ...(values.distanceKm.trim() === "" &&
    values.paceFrom.trim() === "" &&
    values.paceTo.trim() === ""
      ? [t("fold.routeUnset")]
      : [
          values.distanceKm.trim() === ""
            ? undefined
            : `${values.distanceKm.trim()} ${t(units === "imperial" ? "unit.mi" : "unit.km")}`,
          values.paceFrom.trim() === "" && values.paceTo.trim() === ""
            ? undefined
            : `${[values.paceFrom.trim(), values.paceTo.trim()].filter((part) => part !== "").join("–")} ${unitLabel}`,
        ]),
    values.note.trim() === "" ? t("fold.noteNone") : t("fold.noteAdded"),
  ];
  const routeText = routeParts.filter((part) => part !== undefined).join(" · ");
  const routeSummary = routeText.charAt(0).toUpperCase() + routeText.slice(1);

  const whoSummaries: Record<string, string> = {};
  for (const join of ["open", "approval"] as const) {
    const joinText = t(join === "approval" ? "fold.joinApproval" : "fold.joinAnyone");
    whoSummaries[`${join}:public`] = t("fold.whoPublic", { join: joinText });
    whoSummaries[`${join}:link`] = t("fold.whoSummary", {
      join: joinText,
      find: t("fold.findLink"),
    });
    whoSummaries[`${join}:followers`] = t("fold.whoSummary", {
      join: joinText,
      find: t("fold.findFollowers"),
    });
  }
  const whoSummary = whoSummaries[`${joinMode}:${effectiveVisibility}`] ?? "";

  const sharesOn = SHARE_BUTTONS.some((button) => values[SHARE_BUTTON_FIELDS[button]] === "1");
  const sameColor = (value: string, fallback: string) =>
    value === "" || value.toUpperCase() === fallback.toUpperCase();
  const colorsDefault =
    sameColor(values.primaryColor, DEFAULT_COLORS.primary) &&
    sameColor(values.secondaryColor, DEFAULT_COLORS.secondary);
  const lookSummary = t("fold.lookSummary", {
    buttons: t(sharesOn ? "fold.on" : "fold.off"),
    colors: t(colorsDefault ? "fold.colorsDefault" : "fold.colorsCustom"),
  });

  const recapDays = recapWindowDays[RECAP_WINDOWS.find((w) => w === recapWindow) ?? "1d"];
  const afterSummary = t("fold.afterSummary", {
    days: t("fold.days", { count: Number(retentionDays) }),
    recap: recapDays === 0 ? t("fold.recapNone") : t("fold.recapDays", { count: recapDays }),
  });

  return (
    <form
      method="post"
      action={action}
      class="plan-form"
      enctype={withGpx ? "multipart/form-data" : undefined}
    >
      <h1 class="page-purpose">{heading}</h1>
      {notice !== undefined && <p class="warning">{notice}</p>}
      {errors.length > 0 && (
        <p class="error" role="alert">
          {t("form.errors")}
        </p>
      )}
      <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
      {nonce !== undefined && <input type="hidden" name="nonce" value={nonce} />}

      {/* The title is the big heading, edited in place (decision D71): a visually hidden label
          keeps it a named field; the default title is selected on first focus. */}
      <div
        class={titleError === undefined ? "field field-title" : "field field-title field-invalid"}
      >
        <label class="visually-hidden" for={id("title")}>
          {t("form.title")}
        </label>
        <div class="title-field">
          {input("title", {
            class: "title-input",
            required: true,
            maxlength: PLAN_LIMITS.title,
            autocomplete: "off",
            ...(values.title === t("form.defaultTitle") ? { "data-select-on-focus": "" } : {}),
          })}
          <span class="icon icon-pencil title-edit-icon" aria-hidden="true"></span>
        </div>
        {titleError !== undefined && (
          <p class="error" id={`${id("title")}-error`}>
            {fieldErrorMessage(titleError.code, t)}
          </p>
        )}
      </div>

      <Field field="activity" label={t("form.activity")} class="field-compact">
        <select
          id={id("activity")}
          name="activity"
          aria-invalid={errorFor("activity") !== undefined ? "true" : undefined}
          aria-describedby={
            errorFor("activity") !== undefined ? `${id("activity")}-error` : undefined
          }
        >
          {ACTIVITY_TYPES.map((activity) => (
            <option value={activity} selected={values.activity === activity}>
              {t(`activity.${activity}`)}
            </option>
          ))}
        </select>
      </Field>

      <div class="field-row">
        {!forTemplate && (
          <Field field="date" label={t("form.date")}>
            {input("date", { type: "date", required: true })}
          </Field>
        )}
        <Field field="time" label={t("form.time")}>
          {input("time", {
            type: "time",
            required: true,
            ...(onQuarterHour(values.time) ? { step: TIME_STEP_SECONDS } : {}),
          })}
        </Field>
      </div>

      <details class="zone-line" open={errorFor("timeZone") !== undefined}>
        <summary>
          <span class="visually-hidden">{`${t("form.timeZone")}, `}</span>
          <span data-zone-name>{shownZone}</span>
          {" · "}
          <span class="zone-change">{t("layout.change")}</span>
        </summary>
        <Field field="timeZone" label={t("form.timeZone")}>
          <select id={id("timeZone")} name="timeZone" data-detect-zone={detectZoneFrom}>
            {timeZones.map((zone) => (
              <option value={zone} selected={values.timeZone === zone}>
                {zone}
              </option>
            ))}
          </select>
        </Field>
      </details>

      <section class="where">
        <h2>{t("form.where")}</h2>
        <MapTools t={t} map={map} placeSearch={placeSearch} />

        <Field
          field="areaLabel"
          label={t("form.areaLabel")}
          hint={`${t("form.areaLabelHint")} ${t("form.publicHint")}`}
        >
          {input("areaLabel", { required: true, maxlength: PLAN_LIMITS.areaLabel })}
          {map !== undefined && placeSearch && (
            <p class="hint" data-label-suggested="" role="status" hidden>
              {t("form.areaLabelSuggested")}
            </p>
          )}
        </Field>

        {/* With the map script the area point is set on the map; the script hides these fields,
            except where one has an error (decision D66). */}
        <details
          data-area-fields=""
          open={values.areaLat !== "" || values.areaLng !== "" || hasError("areaLat", "areaLng")}
        >
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

        <Fold
          title={t("fold.exact")}
          value={exactSummaries[`${joinMode}:${exactSet ? "set" : "none"}`]}
          kind="exact"
          summaries={exactSummaries}
          open={exactSet || hasError("exactDescription", "exactLat", "exactLng")}
        >
          <p class="hint">{t("form.exactStartHint")}</p>
          <p class="hint">{t("form.openModeWarning")}</p>
          <Field field="exactDescription" label={t("form.exactDescription")}>
            {input("exactDescription", { maxlength: 200 })}
          </Field>
          {/* The map script shows this line and hides the coordinate fields below it (decision
              D66); without the script or with maps off the fields stay. */}
          {map !== undefined && (
            <div class="point-readout" data-exact-readout="" hidden>
              <p data-exact-set="" hidden>
                {t("map.exactSet")}
                {" · "}
                <button type="button" class="secondary" data-exact-remove="">
                  {t("map.exactRemove")}
                </button>
              </p>
              <p data-exact-none="" tabindex={-1}>
                {t("map.exactNone")}
              </p>
            </div>
          )}
          <div class="field-row" data-exact-fields="">
            <Field field="exactLat" label={t("form.latitude")}>
              {input("exactLat", { inputmode: "decimal" })}
            </Field>
            <Field field="exactLng" label={t("form.longitude")}>
              {input("exactLng", { inputmode: "decimal" })}
            </Field>
          </div>
        </Fold>
      </section>

      {hostNameCollapsed ? (
        <details class="host-name">
          <summary>
            {t("form.hostingAs", { name: values.posterName })}
            {" · "}
            <span class="zone-change">{t("layout.change")}</span>
          </summary>
          {hostNameField}
        </details>
      ) : (
        hostNameField
      )}

      <div class="folds">
        <Fold
          title={t("fold.route")}
          value={routeSummary}
          open={hasError(
            "distanceKm",
            "elevationGainM",
            "paceFrom",
            "paceTo",
            "dropPolicy",
            "gpx",
            "note",
          )}
        >
          <div class="field-row">
            <Field
              field="distanceKm"
              label={t("form.distance", {
                unit: t(units === "imperial" ? "unit.mi" : "unit.km"),
              })}
            >
              {input("distanceKm", { inputmode: "decimal" })}
            </Field>
            <Field
              field="elevationGainM"
              label={t("form.elevation", {
                unit: t(units === "imperial" ? "unit.ft" : "unit.m"),
              })}
            >
              {input("elevationGainM", { inputmode: "numeric" })}
            </Field>
          </div>

          <fieldset>
            <legend>{t("form.pace")}</legend>
            <p class="hint">
              {t(units === "imperial" ? "form.paceHintImperial" : "form.paceHint")}
            </p>
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
          {withGpx && (
            <RouteTrimField t={t} id="field-gpxTrim" selected={routeTrim} units={units} />
          )}

          <Field field="note" label={t("form.note")} hint={t("form.publicHint")}>
            <textarea id={id("note")} name="note" rows={4} maxlength={PLAN_LIMITS.note}>
              {values.note}
            </textarea>
          </Field>
        </Fold>

        <Fold
          title={t("fold.who")}
          value={whoSummary}
          kind="who"
          summaries={whoSummaries}
          strong
          warning={effectiveVisibility === "public"}
          open={hasError("joinMode", "visibility") || confirmAcceptPending !== undefined}
        >
          <fieldset>
            <legend>{t("form.joinMode")}</legend>
            <p class="hint">{t("form.joinModeHint")}</p>
            {JOIN_MODES.map((mode) => (
              <label class="choice">
                <input type="radio" name="joinMode" value={mode} checked={joinMode === mode} />
                {t(mode === "open" ? "form.joinOpen" : "form.joinApproval")}
              </label>
            ))}
            {errorFor("joinMode") !== undefined && (
              <p class="error">{fieldErrorMessage("choice_invalid", t)}</p>
            )}
          </fieldset>

          {visibility !== undefined && (
            <VisibilityFieldset
              t={t}
              choice={visibility}
              value={values.visibility}
              error={errorFor("visibility")}
            />
          )}
        </Fold>

        <Fold
          title={t("fold.look")}
          value={lookSummary}
          open={hasError(
            ...SHARE_BUTTONS.map((button) => SHARE_BUTTON_FIELDS[button]),
            "primaryColor",
            "secondaryColor",
          )}
        >
          <ShareFieldset
            t={t}
            values={values}
            error={SHARE_BUTTONS.map((button) => errorFor(SHARE_BUTTON_FIELDS[button])).find(
              Boolean,
            )}
          />

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
        </Fold>

        <Fold
          title={t("fold.after")}
          value={afterSummary}
          open={hasError(
            "retentionDays",
            "recapWindow",
            "keepAsTemplate",
            "templateIncludePrivate",
          )}
        >
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
            <RecapWindowSelect t={t} id={id("recapWindow")} selected={recapWindow} />
          </Field>

          {!forTemplate && <TemplateOptions t={t} values={values} errors={errors} />}
        </Fold>
      </div>

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

/** "Share buttons on the plan page", chosen by the host (decision D41). */
function ShareFieldset({
  t,
  values,
  error,
}: {
  t: Translate;
  values: PlanInput;
  error: FieldError | undefined;
}) {
  return (
    <fieldset class={error === undefined ? undefined : "field-invalid"}>
      <legend>{t("form.shareButtons")}</legend>
      {SHARE_BUTTONS.map((button) => {
        const field = SHARE_BUTTON_FIELDS[button];
        return (
          <label class="choice">
            <input type="checkbox" name={field} value="1" checked={values[field] === "1"} />
            {t(`form.${field}`)}
          </label>
        );
      })}
      <p class="hint">{t("form.shareButtonsHint")}</p>
      {error !== undefined && <p class="error">{fieldErrorMessage(error.code, t)}</p>}
    </fieldset>
  );
}

/**
 * "Who can find this plan": link-only, followers or public, each where the plan may be (decisions
 * D35, D37), the fediverse named where the owner's profile shares it. Where a choice may not be
 * made, link-only is the one shown: a disabled radio is never sent, so showing it as chosen would
 * save something else than the form says.
 */
function VisibilityFieldset({
  t,
  choice,
  value,
  error,
}: {
  t: Translate;
  choice: VisibilityChoice;
  value: string;
  error: FieldError | undefined;
}) {
  const { followers, sharedBy } = choice;
  const handle = { handle: sharedBy ?? "" };
  const { options, shown, chosen } = visibilityAvailability(choice, value);
  const labels: Record<Choosable, string> = {
    link: t("form.visibilityLink"),
    followers:
      sharedBy === undefined
        ? t("form.visibilityFollowersNone")
        : t("form.visibilityFollowers", handle),
    public:
      sharedBy === undefined
        ? t("form.visibilityPublic")
        : choice.nearby
          ? t("form.visibilityPublicShared", handle)
          : t("form.visibilityPublicProfile", handle),
  };
  if (shown.length === 1) return null;
  return (
    <fieldset>
      <legend>{t("form.visibility")}</legend>
      <p class="hint">{t("form.visibilityPublicHint")}</p>
      {shown.map((visibility) => (
        <label class="choice">
          <input
            type="radio"
            name="visibility"
            value={visibility}
            checked={(chosen ?? "link") === visibility}
            disabled={!options[visibility].allowed}
          />
          {labels[visibility]}
        </label>
      ))}
      {choice.fediverse === "shared" && <p class="warning">{t("form.fediverseShared")}</p>}
      {choice.fediverse === "withdrawn" && <p class="hint">{t("form.fediverseWithdrawn")}</p>}
      {followers !== undefined && !followers.allowed && (
        <p class="hint">
          {t("form.followersNeedsProfile")}{" "}
          <a href="/account#profile">
            {t(choice.hasAccount ? "form.followersSetUp" : "form.followersLogInSetUp")}
          </a>
        </p>
      )}
      {!choice.publicAllowed && choice.loginHref !== undefined && (
        <p class="hint">
          {t("form.publicNeedsLogin")} <a href={choice.loginHref}>{t("form.publicLogIn")}</a>
        </p>
      )}
      {error !== undefined && <p class="error">{fieldErrorMessage(error.code, t)}</p>}
    </fieldset>
  );
}
