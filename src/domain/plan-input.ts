// Validation of the create-plan form (spec 5 feature 1, 3.1). Takes the raw form strings
// and returns a complete draft or every field error at once.
import { ACTIVITY_TYPES, type ActivityType, paceStyleFor } from "./activity.ts";
import { type HexColor, parseHexColor } from "./color.ts";
import {
  type ExactStart,
  type GeoPoint,
  publicAreaFrom,
  validateExactStart,
  validateGeoPoint,
} from "./geo.ts";
import { type PaceBand, paceFromSpeed, parsePace, validatePaceBand } from "./pace.ts";
import { distanceToMeters, elevationToMeters, type Units } from "./units.ts";
import {
  CHOOSABLE_VISIBILITIES,
  DROP_POLICIES,
  type DropPolicy,
  JOIN_MODES,
  type JoinMode,
  type Visibility,
} from "./plan.ts";
import { fitRecapWindow } from "./recap.ts";
import {
  defaultRecapWindow,
  defaultRetentionDays,
  deleteAt,
  RECAP_WINDOWS,
  type RecapWindow,
  validateRetention,
  validateStartsAt,
} from "./schedule.ts";
import type { FieldError as GenericFieldError } from "./result.ts";
import { cleanText } from "./text.ts";
import { localToInstant, validateTimeZone } from "./timezone.ts";

/** Form field names, also used as the HTML `name` attributes. */
export const PLAN_INPUT_FIELDS = [
  "posterName",
  "activity",
  "title",
  "note",
  "date",
  "time",
  "timeZone",
  "areaLabel",
  "areaLat",
  "areaLng",
  "exactDescription",
  "exactLat",
  "exactLng",
  "distanceKm",
  "elevationGainM",
  // min:ss for pace activities, whole km/h or mph for speed activities; either order.
  "paceFrom",
  "paceTo",
  "dropPolicy",
  // "open" or "approval" (spec 3.4); empty means open.
  "joinMode",
  // "link" or "public" (spec 3.3, decision D35); empty means link.
  "visibility",
  "primaryColor",
  "secondaryColor",
  "retentionDays",
  // "now", "1d" or "1w" (spec 6 feature 6); empty means the largest that fits the retention.
  "recapWindow",
  // Checkboxes, "1" when ticked (spec 3.10 Templates).
  "keepAsTemplate",
  "templateIncludePrivate",
] as const;

/** Raw form values; empty strings mean "not given". */
export type PlanInput = Record<(typeof PLAN_INPUT_FIELDS)[number], string>;

export type PlanField = keyof PlanInput;
/** Plan form errors; "gpx" is the optional route file field (spec 5 feature 2). */
export type FieldError = GenericFieldError<PlanField | "gpx">;
export type Validation<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

export interface PlanDraft {
  posterName: string;
  activity: ActivityType;
  title: string;
  note: string | undefined;
  startsAt: Date;
  timeZone: string;
  area: { label: string; point: GeoPoint | undefined };
  exactStart: ExactStart | undefined;
  distanceMeters: number | undefined;
  elevationGainMeters: number | undefined;
  pace: PaceBand | undefined;
  dropPolicy: DropPolicy;
  joinMode: JoinMode;
  /** Who can find the plan (spec 3.3); whether `public` is allowed is the use case's to check. */
  visibility: Visibility;
  colors: { primary: HexColor; secondary: HexColor };
  retentionDays: number;
  recapWindow: RecapWindow;
  deleteAt: Date;
  template: TemplateOption;
}

/** "Keep as repeatable template", and whether it includes the exact start and route (spec 3.10). */
export interface TemplateOption {
  keep: boolean;
  /** Only together with `keep`. */
  includePrivate: boolean;
}

/** The template checkboxes; anything but empty or "1" is invalid. */
export function validateTemplateOption(
  input: Pick<PlanInput, "keepAsTemplate" | "templateIncludePrivate">,
): { ok: true; value: TemplateOption } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const flag = (field: "keepAsTemplate" | "templateIncludePrivate") => {
    const value = input[field].trim();
    if (value !== "" && value !== "1") errors.push({ field, code: "choice_invalid" });
    return value === "1";
  };
  const keep = flag("keepAsTemplate");
  const includePrivate = flag("templateIncludePrivate");
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: { keep, includePrivate: keep && includePrivate } };
}

/** Decision D7. */
export const PLAN_LIMITS = {
  posterName: 50,
  title: 100,
  areaLabel: 100,
  note: 2000,
  distanceKm: { min: 0.1, max: 1000 },
  elevationGainM: { max: 20000 },
} as const;

export interface PlanRules {
  now: Date;
  horizonDays: number;
  maxRetentionDays: number;
}

const DECIMAL = /^\d+(?:[.,]\d+)?$/;
const WHOLE = /^\d+$/;
const COORDINATE = /^-?\d+(?:[.,]\d+)?$/;

export function validatePlanInput(
  input: PlanInput,
  rules: PlanRules,
  units: Units,
  /**
   * When editing: a start equal to `unchangedStart` is not re-checked against "now" (spec 3.1 Start date),
   * and a retention equal to `unchangedRetention` stays valid above a lowered maximum (spec 3.10).
   */
  {
    unchangedStart,
    unchangedRetention,
  }: { unchangedStart?: Date | undefined; unchangedRetention?: number | undefined } = {},
): Validation<PlanDraft> {
  const errors: FieldError[] = [];
  const fail = (field: PlanField, code: string): undefined => {
    errors.push({ field, code });
    return undefined;
  };

  const text = (field: PlanField, max: number, { required = false, multiline = false } = {}) => {
    const result = cleanText(input[field], { max, multiline });
    if (!result.ok) return fail(field, result.error);
    if (required && result.value === undefined) return fail(field, "required");
    return result.value;
  };

  const choice = <T extends string>(
    field: PlanField,
    options: readonly T[],
    value: string = input[field],
  ): T | undefined =>
    (options as readonly string[]).includes(value) ? (value as T) : fail(field, "choice_invalid");

  const coordinates = (latField: PlanField, lngField: PlanField): GeoPoint | undefined => {
    const [lat, lng] = [input[latField].trim(), input[lngField].trim()];
    if (lat === "" && lng === "") return undefined;
    if (!COORDINATE.test(lat) || !COORDINATE.test(lng))
      return fail(latField, "coordinates_invalid");
    const point = validateGeoPoint({
      lat: Number(lat.replace(",", ".")),
      lng: Number(lng.replace(",", ".")),
    });
    return point.ok ? point.value : fail(latField, point.error);
  };

  const posterName = text("posterName", PLAN_LIMITS.posterName, { required: true });
  const activity = choice("activity", ACTIVITY_TYPES);
  const title = text("title", PLAN_LIMITS.title, { required: true });
  const note = text("note", PLAN_LIMITS.note, { multiline: true });

  // Start time in the plan's time zone.
  let startsAt: Date | undefined;
  const zone = validateTimeZone(input.timeZone);
  const timeZone = zone.ok ? zone.value : undefined;
  if (!zone.ok) {
    fail("timeZone", zone.error);
  } else {
    const instant = localToInstant(input.date.trim(), input.time.trim(), zone.value);
    if (!instant.ok) {
      fail("date", instant.error);
    } else {
      if (unchangedStart !== undefined && instant.value.getTime() === unchangedStart.getTime()) {
        startsAt = instant.value;
      } else {
        const checked = validateStartsAt(instant.value, rules.now, rules.horizonDays);
        startsAt = checked.ok ? checked.value : fail("date", checked.error);
      }
    }
  }

  // Public area and exact start; the public point comes from the exact point when there is one.
  const areaLabel = text("areaLabel", PLAN_LIMITS.areaLabel, { required: true });
  const areaPoint = coordinates("areaLat", "areaLng");
  const exactPoint = coordinates("exactLat", "exactLng");
  const exactDescription = input.exactDescription.trim();
  let exactStart: ExactStart | undefined;
  if (exactPoint !== undefined || exactDescription !== "") {
    const result = validateExactStart({ point: exactPoint, description: exactDescription });
    if (!result.ok)
      fail(result.error === "coordinates_invalid" ? "exactLat" : "exactDescription", result.error);
    else exactStart = result.value;
  }
  const publicSource = exactStart?.point ?? areaPoint;
  const publicPoint = publicSource === undefined ? undefined : publicAreaFrom(publicSource);

  // Distance and elevation.
  let distanceMeters: number | undefined;
  const distance = input.distanceKm.trim();
  if (distance !== "") {
    const value = DECIMAL.test(distance) ? Number(distance.replace(",", ".")) : Number.NaN;
    const km = distanceToMeters(value, units) / 1000;
    if (Number.isNaN(km)) fail("distanceKm", "number_invalid");
    else if (km < PLAN_LIMITS.distanceKm.min || km > PLAN_LIMITS.distanceKm.max)
      fail("distanceKm", "out_of_range");
    else distanceMeters = Math.round(km * 1000);
  }
  let elevationGainMeters: number | undefined;
  const elevation = input.elevationGainM.trim();
  if (elevation !== "") {
    const meters = WHOLE.test(elevation)
      ? Math.round(elevationToMeters(Number(elevation), units))
      : Number.NaN;
    if (Number.isNaN(meters)) fail("elevationGainM", "number_invalid");
    else if (meters > PLAN_LIMITS.elevationGainM.max) fail("elevationGainM", "out_of_range");
    else elevationGainMeters = meters;
  }

  // Pace band, in the style of the activity.
  let pace: PaceBand | undefined;
  if (activity !== undefined) {
    const style = paceStyleFor(activity);
    const read = (field: "paceFrom" | "paceTo"): number | undefined => {
      const value = input[field].trim();
      if (value === "") return undefined;
      const result =
        style === "pace"
          ? parsePace(value, units)
          : WHOLE.test(value)
            ? paceFromSpeed(Number(value), units)
            : ({ ok: false, error: "speed_invalid" } as const);
      return result.ok ? result.value : fail(field, result.error);
    };
    const values = [read("paceFrom"), read("paceTo")].filter(
      (value): value is number => value !== undefined,
    );
    if (values.length > 0 && !errors.some((e) => e.field === "paceFrom" || e.field === "paceTo")) {
      const band = validatePaceBand({ fastest: Math.min(...values), slowest: Math.max(...values) });
      pace = band.ok ? band.value : fail("paceFrom", band.error);
    }
  }

  const dropPolicy = choice("dropPolicy", DROP_POLICIES);
  const joinMode = input.joinMode === "" ? "open" : choice("joinMode", JOIN_MODES);
  const visibility =
    input.visibility === "" ? "link" : choice("visibility", CHOOSABLE_VISIBILITIES);
  const primary = parseHexColor(input.primaryColor.trim());
  if (!primary.ok) fail("primaryColor", primary.error);
  const secondary = parseHexColor(input.secondaryColor.trim());
  if (!secondary.ok) fail("secondaryColor", secondary.error);

  // Retention and the recap window that fits it (decision D4).
  let retentionDays: number | undefined;
  const retention = input.retentionDays.trim();
  const requested =
    retention === ""
      ? defaultRetentionDays(rules.maxRetentionDays)
      : WHOLE.test(retention)
        ? Number(retention)
        : Number.NaN;
  // Existing plans keep their promised period when the instance maximum is lowered (spec 3.10).
  const maxRetention =
    requested === unchangedRetention
      ? Math.max(rules.maxRetentionDays, requested)
      : rules.maxRetentionDays;
  const checkedRetention = validateRetention(
    requested,
    defaultRecapWindow(requested),
    maxRetention,
  );
  if (checkedRetention.ok) retentionDays = checkedRetention.value;
  else fail("retentionDays", checkedRetention.error);
  // A window longer than the retention is shortened to fit, never lengthened (decision D4).
  const chosenWindow =
    input.recapWindow.trim() === ""
      ? undefined
      : choice("recapWindow", RECAP_WINDOWS, input.recapWindow.trim());
  const template = validateTemplateOption(input);
  if (!template.ok) errors.push(...template.errors);

  if (
    errors.length > 0 ||
    posterName === undefined ||
    activity === undefined ||
    title === undefined ||
    startsAt === undefined ||
    timeZone === undefined ||
    areaLabel === undefined ||
    dropPolicy === undefined ||
    joinMode === undefined ||
    visibility === undefined ||
    !primary.ok ||
    !secondary.ok ||
    retentionDays === undefined ||
    !template.ok
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      posterName,
      activity,
      title,
      note,
      startsAt,
      timeZone,
      area: { label: areaLabel, point: publicPoint },
      exactStart,
      distanceMeters,
      elevationGainMeters,
      pace,
      dropPolicy,
      joinMode,
      visibility,
      colors: { primary: primary.value, secondary: secondary.value },
      retentionDays,
      recapWindow:
        chosenWindow === undefined
          ? defaultRecapWindow(retentionDays)
          : fitRecapWindow(chosenWindow, retentionDays),
      deleteAt: deleteAt(startsAt, retentionDays),
      template: template.value,
    },
  };
}
