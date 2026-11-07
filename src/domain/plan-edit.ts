// Editing, cancelling and removing (spec 3.1 Editing, Retention edits; 3.5; 5 features 7–8; decision D8).
import { paceStyleFor } from "./activity.ts";
import { formatPace, formatSpeed, type Units } from "./pace.ts";
import type { Plan } from "./plan.ts";
import {
  type PlanDraft,
  type PlanInput,
  type PlanRules,
  type Validation,
  validatePlanInput,
} from "./plan-input.ts";
import type { PlanResponse } from "./response.ts";
import { err, ok, type Result } from "./result.ts";
import { defaultRecapWindow, deleteAt, type RecapWindow, validateRetention } from "./schedule.ts";
import { instantToLocal } from "./timezone.ts";

/** Everything before the start of an active plan; afterwards, or once cancelled, only retention. */
export function editScope(plan: Pick<Plan, "startsAt" | "status">, now: Date): "all" | "retention" {
  return plan.status === "active" && now.getTime() < plan.startsAt.getTime() ? "all" : "retention";
}

const decimal = (value: number) => String(Number(value.toFixed(3)));

/** The create/edit form values for a stored plan; saving them unchanged reproduces the plan. */
export function planToInput(plan: Plan, units: Units): PlanInput {
  const local = instantToLocal(plan.startsAt, plan.timeZone);
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
    date: local.date,
    time: local.time,
    timeZone: plan.timeZone,
    areaLabel: plan.area.label,
    areaLat: areaPoint === undefined ? "" : String(areaPoint.lat),
    areaLng: areaPoint === undefined ? "" : String(areaPoint.lng),
    exactDescription: plan.exactStart?.description ?? "",
    exactLat: exactPoint === undefined ? "" : String(exactPoint.lat),
    exactLng: exactPoint === undefined ? "" : String(exactPoint.lng),
    distanceKm: plan.distanceMeters === undefined ? "" : decimal(plan.distanceMeters / 1000),
    elevationGainM: plan.elevationGainMeters === undefined ? "" : String(plan.elevationGainMeters),
    // Faster first for pace, slower first for speed, as people say them ("5:30 to 6:00", "25 to 28 km/h").
    paceFrom: pace === undefined ? "" : paceValue(style === "pace" ? pace.fastest : pace.slowest),
    paceTo: pace === undefined ? "" : paceValue(style === "pace" ? pace.slowest : pace.fastest),
    dropPolicy: plan.dropPolicy,
    primaryColor: plan.colors.primary,
    secondaryColor: plan.colors.secondary,
    retentionDays: String(plan.retentionDays),
  };
}

/** Full edit before the start; a changed start must be in the future (spec 3.1 Start date). */
export function validatePlanEdit(
  input: PlanInput,
  plan: Plan,
  rules: PlanRules,
  units: Units,
): Validation<PlanDraft> {
  return validatePlanInput(input, rules, units, { unchangedStart: plan.startsAt });
}

export interface RetentionEdit {
  retentionDays: number;
  recapWindow: RecapWindow;
  deleteAt: Date;
  /** The new deletion date has passed: the UI must confirm "This will delete the plan now". */
  deletesNow: boolean;
}

/** Retention can change at any time; delete_at is always recomputed (spec 3.1 Retention edits). */
export function validateRetentionEdit(
  value: string,
  plan: Pick<Plan, "startsAt">,
  now: Date,
  maxRetentionDays: number,
): Result<RetentionEdit, "retention_out_of_range" | "retention_shorter_than_recap_window"> {
  const days = /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
  const recapWindow = defaultRecapWindow(days);
  const checked = validateRetention(days, recapWindow, maxRetentionDays);
  if (!checked.ok) return checked;
  const newDeleteAt = deleteAt(plan.startsAt, checked.value);
  return ok({
    retentionDays: checked.value,
    recapWindow,
    deleteAt: newDeleteAt,
    deletesNow: newDeleteAt.getTime() <= now.getTime(),
  });
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

/** Restores a removed person's previous state (spec 3.5). */
export function undoRemoval(
  response: PlanResponse,
  now: Date,
): Result<PlanResponse, "not_removed"> {
  if (response.kind !== "removed" || response.previousKind === undefined) return err("not_removed");
  return ok({ ...response, kind: response.previousKind, previousKind: undefined, updatedAt: now });
}
