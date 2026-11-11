// Editing, cancelling and removing (spec 3.1 Editing, Retention edits; 3.5; 5 features 7–8; decision D8).
import { paceStyleFor } from "./activity.ts";
import { formatPace, formatSpeed } from "./pace.ts";
import { metersToDistance, metersToElevation, type Units } from "./units.ts";
import type { Plan } from "./plan.ts";
import {
  type FieldError,
  type PlanDraft,
  type PlanInput,
  type PlanRules,
  type TemplateOption,
  type Validation,
  validatePlanInput,
  validateTemplateOption,
} from "./plan-input.ts";
import type { PlanResponse } from "./response.ts";
import { err, ok, type Result } from "./result.ts";
import { changeRecapWindow, fitRecapWindow } from "./recap.ts";
import {
  defaultRecapWindow,
  deleteAt,
  RECAP_WINDOWS,
  type RecapWindow,
  validateRetention,
} from "./schedule.ts";
import { instantToLocal } from "./timezone.ts";

/** Everything before the start of an active plan; afterwards, or once cancelled, only retention. */
export function editScope(plan: Pick<Plan, "startsAt" | "status">, now: Date): "all" | "retention" {
  return plan.status === "active" && now.getTime() < plan.startsAt.getTime() ? "all" : "retention";
}

const decimal = (value: number) => String(Number(value.toFixed(3)));

/** What plans and templates share (spec 3.10 Templates). */
export type PlanDetails = Pick<
  Plan,
  | "posterName"
  | "activity"
  | "title"
  | "note"
  | "timeZone"
  | "area"
  | "exactStart"
  | "distanceMeters"
  | "elevationGainMeters"
  | "pace"
  | "dropPolicy"
  | "joinMode"
  | "visibility"
  | "colors"
  | "retentionDays"
  | "recapWindow"
>;

type DateAndOptionFields = "date" | "time" | "keepAsTemplate" | "templateIncludePrivate";

/** The create/edit form values for a stored plan; saving them unchanged reproduces the plan. */
export function planToInput(plan: Plan, units: Units): PlanInput {
  const local = instantToLocal(plan.startsAt, plan.timeZone);
  return {
    ...detailsToInput(plan, units),
    date: local.date,
    time: local.time,
    keepAsTemplate: plan.template.keep ? "1" : "",
    templateIncludePrivate: plan.template.includePrivate ? "1" : "",
  };
}

/** Form values for everything but the date, time and template options. */
export function detailsToInput(
  plan: PlanDetails,
  units: Units,
): Omit<PlanInput, DateAndOptionFields> {
  const exactPoint = plan.exactStart?.point;
  // The public point is derived from the exact point when there is one, so it is not a form value then.
  const areaPoint = exactPoint === undefined ? plan.area.point : undefined;
  const pace = plan.pace;
  const style = paceStyleFor(plan.activity);
  const paceValue = (secondsPerKm: number) =>
    style === "pace" ? formatPace(secondsPerKm, units) : formatSpeed(secondsPerKm, units);
  return {
    posterName: plan.posterName,
    activity: plan.activity,
    title: plan.title,
    note: plan.note ?? "",
    timeZone: plan.timeZone,
    areaLabel: plan.area.label,
    areaLat: areaPoint === undefined ? "" : String(areaPoint.lat),
    areaLng: areaPoint === undefined ? "" : String(areaPoint.lng),
    exactDescription: plan.exactStart?.description ?? "",
    exactLat: exactPoint === undefined ? "" : String(exactPoint.lat),
    exactLng: exactPoint === undefined ? "" : String(exactPoint.lng),
    distanceKm:
      plan.distanceMeters === undefined
        ? ""
        : decimal(metersToDistance(plan.distanceMeters, units)),
    elevationGainM:
      plan.elevationGainMeters === undefined
        ? ""
        : String(Math.round(metersToElevation(plan.elevationGainMeters, units))),
    // Faster first for pace, slower first for speed, as people say them ("5:30 to 6:00", "25 to 28 km/h").
    paceFrom: pace === undefined ? "" : paceValue(style === "pace" ? pace.fastest : pace.slowest),
    paceTo: pace === undefined ? "" : paceValue(style === "pace" ? pace.slowest : pace.fastest),
    dropPolicy: plan.dropPolicy,
    joinMode: plan.joinMode,
    visibility: plan.visibility,
    primaryColor: plan.colors.primary,
    secondaryColor: plan.colors.secondary,
    retentionDays: String(plan.retentionDays),
    recapWindow: plan.recapWindow,
  };
}

/** Full edit before the start; a changed start must be in the future (spec 3.1 Start date). */
export function validatePlanEdit(
  input: PlanInput,
  plan: Plan,
  rules: PlanRules,
  units: Units,
): Validation<PlanDraft> {
  return validatePlanInput(input, rules, units, {
    unchangedStart: plan.startsAt,
    unchangedRetention: plan.retentionDays,
  });
}

export interface RetentionEdit {
  template: TemplateOption;
  retentionDays: number;
  recapWindow: RecapWindow;
  recapWindowSetAt: Date | undefined;
  recapClosedAt: Date | undefined;
  deleteAt: Date;
  /** The new deletion date has passed: the UI must confirm "This will delete the plan now". */
  deletesNow: boolean;
}

/**
 * Retention, the recap window and the template options can change at any time; delete_at is
 * always recomputed (spec 3.1 Editing, Retention edits). An unchanged retention stays valid above a lowered maximum (spec 3.10). The
 * window is shortened to fit the retention (decision D4) and, after the start, measured from the
 * change (spec 6 feature 6).
 */
export function validateRetentionEdit(
  input: Pick<
    PlanInput,
    "retentionDays" | "recapWindow" | "keepAsTemplate" | "templateIncludePrivate"
  >,
  plan: Pick<
    Plan,
    "startsAt" | "retentionDays" | "recapWindow" | "recapWindowSetAt" | "recapClosedAt" | "deleteAt"
  >,
  now: Date,
  maxRetentionDays: number,
): { ok: true; value: RetentionEdit } | { ok: false; errors: FieldError[] } {
  const template = validateTemplateOption(input);
  if (!template.ok) return template;
  const value = input.retentionDays.trim();
  const days = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  const max = days === plan.retentionDays ? Math.max(maxRetentionDays, days) : maxRetentionDays;
  const checked = validateRetention(days, defaultRecapWindow(days), max);
  if (!checked.ok) return { ok: false, errors: [{ field: "retentionDays", code: checked.error }] };
  const window = input.recapWindow.trim();
  if (window !== "" && !(RECAP_WINDOWS as readonly string[]).includes(window)) {
    return { ok: false, errors: [{ field: "recapWindow", code: "choice_invalid" }] };
  }
  const requested = window === "" ? plan.recapWindow : (window as RecapWindow);
  const newDeleteAt = deleteAt(plan.startsAt, checked.value);
  return {
    ok: true,
    value: {
      template: template.value,
      retentionDays: checked.value,
      ...changeRecapWindow(plan, fitRecapWindow(requested, checked.value), now),
      deleteAt: newDeleteAt,
      deletesNow: newDeleteAt.getTime() <= now.getTime(),
    },
  };
}

/** Cancelling is final and only possible before the start (decision D8). */
export function canCancel(
  plan: Pick<Plan, "startsAt" | "status">,
  now: Date,
): Result<true, "already_cancelled" | "plan_started"> {
  if (plan.status === "cancelled") return err("already_cancelled");
  if (now.getTime() >= plan.startsAt.getTime()) return err("plan_started");
  return ok(true);
}

/** The host removes a participant or interested person; the previous kind allows undo (spec 3.5). */
export function removeResponse(
  response: PlanResponse,
  now: Date,
): Result<PlanResponse, "not_removable"> {
  if (response.kind !== "joined" && response.kind !== "interested") return err("not_removable");
  return ok({ ...response, kind: "removed", previousKind: response.kind, updatedAt: now });
}

/** What people who responded see and plan around; a save changing none of it notifies nobody (spec 6 feature 3). */
export function isMaterialChange(before: Plan, after: Plan): boolean {
  const seen = (plan: Plan) =>
    JSON.stringify([
      plan.title,
      plan.activity,
      plan.startsAt.getTime(),
      plan.timeZone,
      plan.area,
      plan.exactStart,
      plan.distanceMeters,
      plan.elevationGainMeters,
      plan.pace,
      plan.dropPolicy,
      plan.note,
      plan.joinMode,
    ]);
  return seen(before) !== seen(after);
}
