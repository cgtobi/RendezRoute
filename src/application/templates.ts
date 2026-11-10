// Repeatable templates (spec 3.10 Templates, decision I43): kept when a plan that opted in is
// deleted by retention or its host, or saved from a live plan; viewed, edited, repeated and
// deleted by the devices linked to them.
import type { Plan } from "../domain/plan.ts";
import type { FieldError, PlanInput } from "../domain/plan-input.ts";
import {
  type PlanTemplate,
  repeatInput,
  type TemplateAdjustment,
  templateExpiresAt,
  templateFromPlan,
  validateTemplateEdit,
} from "../domain/template.ts";
import { validatePlanInput } from "../domain/plan-input.ts";
import type { Units } from "../domain/units.ts";
import { lookupDevice, resolveDevice } from "./devices.ts";
import { asHost, type Denied, isDenied } from "./host.ts";
import { mayCreatePlans } from "./posting-rules.ts";
import {
  checkCreationNonce,
  CREATION_NONCE,
  type CreatedPlan,
  type PlanDeps,
  storeNewPlan,
} from "./plans.ts";
import type { NewTemplate } from "./ports.ts";

/** The template, if the device is linked to it. */
async function asTemplateHost(
  deps: PlanDeps,
  templateId: string,
  deviceToken: string | undefined,
): Promise<PlanTemplate | Denied> {
  const template = await deps.templates.findById(templateId);
  if (template === undefined) return { kind: "not_found" };
  const device = await resolveDevice(deps, deviceToken);
  if (
    device === undefined ||
    !(await deps.devices.hasLink(device.id, { role: "template", templateId }))
  ) {
    return { kind: "forbidden" };
  }
  return template;
}

/** A template of the plan, with its route when it includes the exact start and route. */
async function newTemplate(
  deps: PlanDeps,
  plan: Plan,
  includePrivate: boolean,
  hostTokenHash: string | undefined,
): Promise<NewTemplate> {
  const template = templateFromPlan(plan, {
    id: deps.ids.planId(),
    includePrivate,
    now: deps.clock.now(),
  });
  return {
    template,
    hostTokenHash,
    route: template.hasRoute ? await deps.plans.findRoute(plan.id) : undefined,
    hostsOfPlan: plan.id,
  };
}

/**
 * Deletes plans by retention or by their host, keeping templates of those that opted in (spec
 * 3.10); never used for own-data or instance-admin deletion. No link is shown for these templates
 * (decision I36).
 */
export async function deletePlansKeepingTemplates(
  deps: PlanDeps,
  plans: readonly Plan[],
): Promise<void> {
  const kept: NewTemplate[] = [];
  for (const plan of plans) {
    if (plan.template.keep) {
      kept.push(await newTemplate(deps, plan, plan.template.includePrivate, undefined));
    }
  }
  // Stored in the same transaction as the deletion.
  await deps.plans.deleteMany(
    plans.map((plan) => plan.id),
    kept,
  );
}

export type SaveAsTemplateResult =
  | Denied
  | { kind: "bad_request" }
  /** The form was sent again: the template it already made. */
  | { kind: "duplicate"; templateId: string }
  | { kind: "saved"; templateId: string; title: string; hostToken: string };

/** "Save as template" on the host page: a template of the live plan, with its own link (spec 3.10). */
export async function saveAsTemplate(
  deps: PlanDeps,
  request: {
    planId: string;
    deviceToken: string | undefined;
    includePrivate: boolean;
    creationNonce: string;
  },
): Promise<SaveAsTemplateResult> {
  const plan = await asHost(deps, request.planId, request.deviceToken);
  if (isDenied(plan)) return plan;
  if (!CREATION_NONCE.test(request.creationNonce)) return { kind: "bad_request" };
  const existing = await deps.templates.findIdByCreationNonce(request.creationNonce);
  if (existing !== undefined) return { kind: "duplicate", templateId: existing };
  const hostToken = deps.tokens.generate();
  const kept = {
    ...(await newTemplate(deps, plan, request.includePrivate, deps.tokens.hash(hostToken))),
    creationNonce: request.creationNonce,
  };
  try {
    await deps.templates.create(kept);
  } catch (error) {
    // A concurrent submit of the same form won the race (the nonce is unique).
    const winner = await deps.templates.findIdByCreationNonce(request.creationNonce);
    if (winner !== undefined) return { kind: "duplicate", templateId: winner };
    throw error;
  }
  return { kind: "saved", templateId: kept.template.id, title: plan.title, hostToken };
}

/** The templates linked to this device, for the home page (spec 3.10). Never changes state. */
export async function listTemplates(
  deps: PlanDeps,
  request: { deviceToken: string | undefined },
): Promise<Pick<PlanTemplate, "id" | "title">[]> {
  const device = await lookupDevice(deps, request.deviceToken);
  if (device === undefined) return [];
  const templates = await deps.templates.listForDevice(device.id);
  return templates.map(({ id, title }) => ({ id, title }));
}

export async function viewTemplate(
  deps: PlanDeps,
  request: { templateId: string; deviceToken: string | undefined },
): Promise<{ kind: "found"; template: PlanTemplate; mayRepeat: boolean } | Denied> {
  const template = await asTemplateHost(deps, request.templateId, request.deviceToken);
  if (isDenied(template)) return template;
  // Repeating creates a plan, so the posting rules decide (spec 7 Moderation).
  return { kind: "found", template, mayRepeat: await mayCreatePlans(deps, request) };
}

/** Repeats and edits count as use: the template stays for another 90 days (spec 3.10). */
const markUsed = (deps: PlanDeps, templateId: string, now: Date) =>
  deps.templates.markUsed(templateId, now, templateExpiresAt(now));

export async function editTemplate(
  deps: PlanDeps,
  request: { templateId: string; deviceToken: string | undefined; input: PlanInput; units: Units },
): Promise<{ kind: "updated" } | { kind: "invalid"; errors: FieldError[] } | Denied> {
  const template = await asTemplateHost(deps, request.templateId, request.deviceToken);
  if (isDenied(template)) return template;
  const now = deps.clock.now();
  const edit = validateTemplateEdit(
    request.input,
    template,
    { now, ...deps.limits },
    request.units,
  );
  if (!edit.ok) return { kind: "invalid", errors: edit.errors };
  await deps.templates.update({ ...template, ...edit.value, updatedAt: now });
  await markUsed(deps, template.id, now);
  return { kind: "updated" };
}

export async function removeTemplateRoute(
  deps: PlanDeps,
  request: { templateId: string; deviceToken: string | undefined },
): Promise<{ kind: "removed" } | Denied> {
  const template = await asTemplateHost(deps, request.templateId, request.deviceToken);
  if (isDenied(template)) return template;
  await deps.templates.deleteRoute(template.id);
  await markUsed(deps, template.id, deps.clock.now());
  return { kind: "removed" };
}

export async function deleteTemplate(
  deps: PlanDeps,
  request: { templateId: string; deviceToken: string | undefined },
): Promise<{ kind: "deleted" } | Denied> {
  const template = await asTemplateHost(deps, request.templateId, request.deviceToken);
  if (isDenied(template)) return template;
  await deps.templates.delete(template.id);
  return { kind: "deleted" };
}

export type RepeatTemplateResult =
  | Denied
  | { kind: "bad_request" }
  | { kind: "duplicate"; planId: string }
  /** The posting rules do not let this device create plans (spec 7 Moderation). */
  | { kind: "not_allowed" }
  /** The date or time is not accepted. */
  | { kind: "invalid"; errors: FieldError[] }
  /** Other settings break the current rules and cannot be adjusted: edit the template first. */
  | { kind: "needs_edit"; errors: FieldError[] }
  | (CreatedPlan & { adjustments: TemplateAdjustment[] });

/**
 * "Repeat": a new plan on a new date with new links and no responses, every setting checked
 * against the current rules; what had to be adjusted is reported (spec 3.10).
 */
export async function repeatTemplate(
  deps: PlanDeps,
  request: {
    templateId: string;
    deviceToken: string | undefined;
    date: string;
    time: string;
    units: Units;
    creationNonce: string;
  },
): Promise<RepeatTemplateResult> {
  const template = await asTemplateHost(deps, request.templateId, request.deviceToken);
  if (isDenied(template)) return template;
  const nonceUsed = await checkCreationNonce(deps, request.creationNonce);
  if (nonceUsed !== undefined) return nonceUsed;
  if (!(await mayCreatePlans(deps, request))) return { kind: "not_allowed" };

  const now = deps.clock.now();
  const { input, adjustments } = repeatInput(
    template,
    request,
    request.units,
    deps.limits.maxRetentionDays,
  );
  const draft = validatePlanInput(input, { now, ...deps.limits }, request.units);
  if (!draft.ok) {
    const own = draft.errors.every((e) => e.field === "date" || e.field === "time");
    return { kind: own ? "invalid" : "needs_edit", errors: draft.errors };
  }
  const route = template.hasRoute ? await deps.templates.findRoute(template.id) : undefined;
  const stored = await storeNewPlan(deps, draft.value, {
    language: template.posterLanguage,
    creationNonce: request.creationNonce,
    deviceToken: request.deviceToken,
    route,
  });
  if (stored.kind === "created") await markUsed(deps, template.id, now);
  return stored.kind === "created" ? { ...stored, adjustments } : stored;
}
