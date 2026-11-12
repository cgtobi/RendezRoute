// Repeatable templates (spec 3.10 Templates, decision I43): a plan's base data kept for repeating
// it, never responses, names, contributions or channels.
import type { Plan, Visibility } from "./plan.ts";
import { detailsToInput, type PlanDetails } from "./plan-edit.ts";
import {
  type FieldError,
  type PlanDraft,
  type PlanInput,
  type PlanRules,
  validatePlanInput,
} from "./plan-input.ts";
import { fitRecapWindow } from "./recap.ts";
import type { RecapWindow } from "./schedule.ts";
import { instantToLocal, validateTimeZone } from "./timezone.ts";
import type { Units } from "./units.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Templates are deleted after 90 days without use; each repeat or edit resets the clock. */
export const TEMPLATE_UNUSED_DAYS = 90;

export interface PlanTemplate extends PlanDetails {
  id: string;
  posterLanguage: string;
  /** Local start time ("07:30") in the template's zone; repeats suggest it (decision I43). */
  startTime: string;
  /** Exact start and route are kept only when the poster opted in (spec 3.10). */
  hasRoute: boolean;
  lastUsedAt: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export function templateExpiresAt(lastUsedAt: Date): Date {
  return new Date(lastUsedAt.getTime() + TEMPLATE_UNUSED_DAYS * DAY_MS);
}

/** A template from a plan; the exact start and route only with `includePrivate`. */
export function templateFromPlan(
  plan: Plan,
  { id, includePrivate, now }: { id: string; includePrivate: boolean; now: Date },
): PlanTemplate {
  return {
    id,
    posterName: plan.posterName,
    posterLanguage: plan.posterLanguage,
    activity: plan.activity,
    title: plan.title,
    note: plan.note,
    timeZone: plan.timeZone,
    startTime: instantToLocal(plan.startsAt, plan.timeZone).time,
    area: plan.area,
    exactStart: includePrivate ? plan.exactStart : undefined,
    hasRoute: includePrivate && plan.hasRoute,
    distanceMeters: plan.distanceMeters,
    elevationGainMeters: plan.elevationGainMeters,
    pace: plan.pace,
    dropPolicy: plan.dropPolicy,
    joinMode: plan.joinMode,
    visibility: plan.visibility,
    colors: plan.colors,
    retentionDays: plan.retentionDays,
    recapWindow: plan.recapWindow,
    shareButtons: plan.shareButtons,
    lastUsedAt: now,
    expiresAt: templateExpiresAt(now),
    createdAt: now,
    updatedAt: now,
  };
}

/** The edit form's values; the date stays empty, since a template has none. */
export function templateToInput(template: PlanTemplate, units: Units): PlanInput {
  return {
    ...detailsToInput(template, units),
    date: "",
    time: template.startTime,
    keepAsTemplate: "",
    templateIncludePrivate: "",
  };
}

export type TemplateEdit = Omit<PlanDraft, "startsAt" | "deleteAt" | "template"> & {
  startTime: string;
};

/**
 * The template edit form: the plan form without date, route and template options. Checked with
 * the plan rules on a stand-in date (tomorrow in the template's zone), so both forms always agree;
 * the time is kept as entered, even if a clock change skips it on that date. An unchanged
 * retention stays valid above a lowered maximum, as for plans (spec 3.10).
 */
export function validateTemplateEdit(
  input: PlanInput,
  template: Pick<PlanTemplate, "retentionDays">,
  rules: PlanRules,
  units: Units,
): { ok: true; value: TemplateEdit } | { ok: false; errors: FieldError[] } {
  const zone = validateTimeZone(input.timeZone);
  const tomorrow = new Date(rules.now.getTime() + DAY_MS);
  const date = instantToLocal(tomorrow, zone.ok ? zone.value : "UTC").date;
  const draft = validatePlanInput(
    { ...input, date, keepAsTemplate: "", templateIncludePrivate: "" },
    rules,
    units,
    { unchangedRetention: template.retentionDays },
  );
  if (!draft.ok) {
    // The stand-in date is always valid, so a "date" error is about the time.
    return {
      ok: false,
      errors: draft.errors.map((e) => (e.field === "date" ? { ...e, field: "time" } : e)),
    };
  }
  const { startsAt: _startsAt, deleteAt: _deleteAt, template: _template, ...details } = draft.value;
  return { ok: true, value: { ...details, startTime: input.time.trim() } };
}

/** What a repeat changed to meet the current rules; the host is told (spec 3.10). */
export type TemplateAdjustment =
  | { field: "retentionDays"; from: number; to: number }
  | { field: "recapWindow"; from: RecapWindow; to: RecapWindow }
  /** Public is no longer allowed for the new plan (decision D35). */
  | { field: "visibility"; from: Visibility; to: Visibility };

/**
 * The plan form values for repeating a template on a new date: a retention above the current
 * maximum is lowered to it, the recap window shortened to fit, and a public template made
 * link-only where the new plan may not be public. The result still goes through the full plan
 * validation. The new plan does not keep a template of its own: this one stays.
 */
export function repeatInput(
  template: PlanTemplate,
  when: { date: string; time: string },
  units: Units,
  {
    maxRetentionDays,
    publicAllowed,
    followersAllowed,
  }: { maxRetentionDays: number; publicAllowed: boolean; followersAllowed: boolean },
): { input: PlanInput; adjustments: TemplateAdjustment[] } {
  const adjustments: TemplateAdjustment[] = [];
  const retentionDays = Math.min(template.retentionDays, maxRetentionDays);
  if (retentionDays !== template.retentionDays) {
    adjustments.push({ field: "retentionDays", from: template.retentionDays, to: retentionDays });
  }
  const recapWindow = fitRecapWindow(template.recapWindow, retentionDays);
  if (recapWindow !== template.recapWindow) {
    adjustments.push({ field: "recapWindow", from: template.recapWindow, to: recapWindow });
  }
  // Back to link-only where the new plan may not be public, or the owner has no profile (D37).
  const visibility =
    (template.visibility === "public" && !publicAllowed) ||
    (template.visibility === "followers" && !followersAllowed)
      ? "link"
      : template.visibility;
  if (visibility !== template.visibility) {
    adjustments.push({ field: "visibility", from: template.visibility, to: visibility });
  }
  return {
    input: {
      ...detailsToInput(template, units),
      date: when.date,
      time: when.time,
      retentionDays: String(retentionDays),
      recapWindow,
      visibility,
      keepAsTemplate: "",
      templateIncludePrivate: "",
    },
    adjustments,
  };
}
