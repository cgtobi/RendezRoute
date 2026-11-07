// The host page: edit, cancel, delete, remove and restore people (spec 5 features 7–9,
// 3.1 Editing and Retention edits, 3.5, decision D8). Only devices linked as host may act.
import type { Units } from "../domain/pace.ts";
import type { Plan } from "../domain/plan.ts";
import {
  canCancel,
  editScope,
  planToInput,
  removeResponse,
  undoRemoval,
  validatePlanEdit,
  validateRetentionEdit,
} from "../domain/plan-edit.ts";
import type { FieldError, PlanInput } from "../domain/plan-input.ts";
import { isPosterName } from "../domain/responding.ts";
import { resolveDevice } from "./devices.ts";
import type { PlanDeps } from "./plans.ts";

export type Denied = { kind: "not_found" } | { kind: "forbidden" };

/** The plan, if the device is linked to it as host. */
export async function asHost(
  deps: PlanDeps,
  planId: string,
  deviceToken: string | undefined,
): Promise<Plan | Denied> {
  const plan = await deps.plans.findById(planId);
  if (plan === undefined) return { kind: "not_found" };
  const device = await resolveDevice(deps, deviceToken);
  if (
    device === undefined ||
    !(await deps.devices.hasLink(device.id, { role: "host", planId: plan.id }))
  ) {
    return { kind: "forbidden" };
  }
  return plan;
}

export const isDenied = (value: Plan | Denied): value is Denied => "kind" in value;

export interface HostPerson {
  responseId: string;
  name: string;
}

export type HostPageResult =
  | Denied
  | {
      kind: "found";
      planId: string;
      title: string;
      /** Edit form values. */
      input: PlanInput;
      scope: "all" | "retention";
      canCancel: boolean;
      hasRoute: boolean;
      people: { participants: HostPerson[]; interested: HostPerson[]; removed: HostPerson[] };
    };

export async function viewHostPage(
  deps: PlanDeps,
  request: { planId: string; deviceToken: string | undefined },
): Promise<HostPageResult> {
  const plan = await asHost(deps, request.planId, request.deviceToken);
  if (isDenied(plan)) return plan;
  const now = deps.clock.now();
  const responses = await deps.responses.listByPlan(plan.id);
  const people = (kind: "joined" | "interested" | "removed") =>
    responses
      .filter((r) => r.kind === kind)
      .map((r) => ({ responseId: r.id, name: r.displayName }));
  return {
    kind: "found",
    planId: plan.id,
    title: plan.title,
    input: planToInput(plan, "metric"),
    scope: editScope(plan, now),
    canCancel: canCancel(plan, now).ok,
    hasRoute: plan.hasRoute,
    people: {
      participants: people("joined"),
      interested: people("interested"),
      removed: people("removed"),
    },
  };
}

export type EditPlanResult =
  | Denied
  | { kind: "updated" }
  | { kind: "invalid"; errors: FieldError[] }
  /** The retention edit would delete the plan now; ask "This will delete the plan now" first. */
  | { kind: "confirm_delete_now" }
  | { kind: "deleted" };

export async function editPlan(
  deps: PlanDeps,
  request: {
    planId: string;
    deviceToken: string | undefined;
    input: PlanInput;
    units: Units;
    /** Set after the host confirmed "This will delete the plan now". */
    confirmDeleteNow: boolean;
  },
): Promise<EditPlanResult> {
  const plan = await asHost(deps, request.planId, request.deviceToken);
  if (isDenied(plan)) return plan;
  const now = deps.clock.now();

  if (editScope(plan, now) === "retention") {
    const edit = validateRetentionEdit(
      request.input.retentionDays,
      plan,
      now,
      deps.limits.maxRetentionDays,
    );
    if (!edit.ok)
      return { kind: "invalid", errors: [{ field: "retentionDays", code: edit.error }] };
    if (edit.value.deletesNow) {
      if (!request.confirmDeleteNow) return { kind: "confirm_delete_now" };
      // Same path as retention deletion; templates and notifications arrive in v0.5.
      await deps.plans.delete(plan.id);
      return { kind: "deleted" };
    }
    const { retentionDays, recapWindow, deleteAt } = edit.value;
    await deps.plans.update({ ...plan, retentionDays, recapWindow, deleteAt, updatedAt: now });
    return { kind: "updated" };
  }

  const draft = validatePlanEdit(request.input, plan, { now, ...deps.limits }, request.units);
  if (!draft.ok) return { kind: "invalid", errors: draft.errors };
  const responses = await deps.responses.listByPlan(plan.id);
  if (responses.some((response) => isPosterName(response.displayName, draft.value.posterName))) {
    return { kind: "invalid", errors: [{ field: "posterName", code: "name_taken_by_response" }] };
  }
  await deps.plans.update({ ...plan, ...draft.value, updatedAt: now });
  return { kind: "updated" };
}

export async function cancelPlan(
  deps: PlanDeps,
  request: { planId: string; deviceToken: string | undefined },
): Promise<
  | Denied
  | { kind: "cancelled" }
  | { kind: "not_allowed"; reason: "already_cancelled" | "plan_started" }
> {
  const plan = await asHost(deps, request.planId, request.deviceToken);
  if (isDenied(plan)) return plan;
  const now = deps.clock.now();
  const allowed = canCancel(plan, now);
  if (!allowed.ok) return { kind: "not_allowed", reason: allowed.error };
  await deps.plans.update({ ...plan, status: "cancelled", updatedAt: now });
  return { kind: "cancelled" };
}

/** Hard delete (spec 1.6). Deletion notifications and templates arrive in v0.5. */
export async function deletePlan(
  deps: PlanDeps,
  request: { planId: string; deviceToken: string | undefined },
): Promise<Denied | { kind: "deleted" }> {
  const plan = await asHost(deps, request.planId, request.deviceToken);
  if (isDenied(plan)) return plan;
  await deps.plans.delete(plan.id);
  return { kind: "deleted" };
}

type PersonRequest = { planId: string; deviceToken: string | undefined; responseId: string };

async function changePerson(
  deps: PlanDeps,
  request: PersonRequest,
  change: typeof removeResponse | typeof undoRemoval,
): Promise<Denied | { kind: "done" } | { kind: "not_allowed" }> {
  const plan = await asHost(deps, request.planId, request.deviceToken);
  if (isDenied(plan)) return plan;
  const response = await deps.responses.findById(request.responseId);
  if (response === undefined || response.planId !== plan.id) return { kind: "not_found" };
  const changed = change(response, deps.clock.now());
  if (!changed.ok) return { kind: "not_allowed" };
  await deps.responses.update(changed.value);
  return { kind: "done" };
}

/** Removal works like rejection: no private details, no new response from that device (spec 3.5). */
export async function removePerson(deps: PlanDeps, request: PersonRequest) {
  const result = await changePerson(deps, request, removeResponse);
  return result.kind === "done" ? { kind: "removed" as const } : result;
}

/** Undo of a removal: the person returns to their previous state (spec 3.5). */
export async function restorePerson(deps: PlanDeps, request: PersonRequest) {
  const result = await changePerson(deps, request, undoRemoval);
  return result.kind === "done" ? { kind: "restored" as const } : result;
}
