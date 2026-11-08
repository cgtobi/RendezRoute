// The host page: edit, cancel, delete, remove and restore people (spec 5 features 7–9,
// 3.1 Editing and Retention edits, 3.5, decision D8). Only devices linked as host may act.
import type { Units } from "../domain/pace.ts";
import type { NotificationKind } from "../domain/notification.ts";
import type { Plan } from "../domain/plan.ts";
import {
  canCancel,
  editScope,
  isMaterialChange,
  planToInput,
  removeResponse,
  validatePlanEdit,
  validateRetentionEdit,
} from "../domain/plan-edit.ts";
import type { FieldError, PlanInput } from "../domain/plan-input.ts";
import * as requests from "../domain/requests.ts";
import { canRespond } from "../domain/responding.ts";
import { isPosterName } from "../domain/responding.ts";
import type { PlanResponse } from "../domain/response.ts";
import type { Result } from "../domain/result.ts";
import { resolveDevice } from "./devices.ts";
import { notifyResponders, notifyResponse } from "./notify.ts";
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

/** A pending request with its note (spec 3.6: only the host sees requests and notes). */
export interface HostRequest extends HostPerson {
  note: string | undefined;
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
      /** Whether pending requests can still be decided: before the start of an active plan (spec 3.1). */
      requestsOpen: boolean;
      hasRoute: boolean;
      people: {
        participants: HostPerson[];
        interested: HostPerson[];
        requests: HostRequest[];
        rejected: HostPerson[];
        removed: HostPerson[];
      };
    };

export async function viewHostPage(
  deps: PlanDeps,
  request: { planId: string; deviceToken: string | undefined; units: Units },
): Promise<HostPageResult> {
  const plan = await asHost(deps, request.planId, request.deviceToken);
  if (isDenied(plan)) return plan;
  const now = deps.clock.now();
  const responses = await deps.responses.listByPlan(plan.id);
  const people = (kind: "joined" | "interested" | "rejected" | "removed") =>
    responses
      .filter((r) => r.kind === kind)
      .map((r) => ({ responseId: r.id, name: r.displayName }));
  return {
    kind: "found",
    planId: plan.id,
    title: plan.title,
    input: planToInput(plan, request.units),
    scope: editScope(plan, now),
    canCancel: canCancel(plan, now).ok,
    requestsOpen: canRespond(plan, now).ok,
    hasRoute: plan.hasRoute,
    people: {
      participants: people("joined"),
      interested: people("interested"),
      requests: responses
        .filter((r) => r.kind === "requested")
        .map((r) => ({ responseId: r.id, name: r.displayName, note: r.requestNote })),
      rejected: people("rejected"),
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
  /** Switching to open mode accepts pending requests; ask "N pending requests will be accepted" first (spec 3.4). */
  | { kind: "confirm_accept_pending"; count: number }
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
    /** The N of a confirmed "N pending requests will be accepted"; asked again if it changed. */
    confirmAcceptPending?: number | undefined;
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
  // Approval → open accepts pending requests; the host confirms exactly how many (spec 3.4).
  const pending = requests.requestsAcceptedBySwitch(plan.joinMode, draft.value.joinMode, responses);
  if (pending.length > 0 && request.confirmAcceptPending !== pending.length) {
    return { kind: "confirm_accept_pending", count: pending.length };
  }
  const updated: Plan = { ...plan, ...draft.value, updatedAt: now };
  await deps.plans.update(updated);
  for (const response of pending) {
    const accepted = requests.acceptRequest(response, plan, now);
    if (accepted.ok) {
      await deps.responses.update(accepted.value);
      await notifyResponse(deps, updated, accepted.value, "accepted");
    }
  }
  if (isMaterialChange(plan, updated)) await notifyResponders(deps, updated, "changed");
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
  const cancelled: Plan = { ...plan, status: "cancelled", updatedAt: now };
  await deps.plans.update(cancelled);
  await notifyResponders(deps, cancelled, "cancelled");
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
type PersonChange = (response: PlanResponse, plan: Plan, now: Date) => Result<PlanResponse, string>;

/** A host action on one person's response; refused changes leave it as it was. */
function personAction<Done extends string>(
  change: PersonChange,
  {
    done,
    notice,
  }: {
    /** The result's kind. */
    done: Done;
    /** What the person is told (spec 3.5: one notice on rejection or removal). */
    notice?: NotificationKind;
  },
) {
  return async (
    deps: PlanDeps,
    request: PersonRequest,
  ): Promise<Denied | { kind: Done } | { kind: "not_allowed" }> => {
    const plan = await asHost(deps, request.planId, request.deviceToken);
    if (isDenied(plan)) return plan;
    const response = await deps.responses.findById(request.responseId);
    if (response === undefined || response.planId !== plan.id) return { kind: "not_found" };
    const changed = change(response, plan, deps.clock.now());
    if (!changed.ok) return { kind: "not_allowed" };
    await deps.responses.update(changed.value);
    if (notice !== undefined) await notifyResponse(deps, plan, changed.value, notice);
    return { kind: done };
  };
}

/** Removal works like rejection: no private details, no new response from that device (spec 3.5). */
export const removePerson = personAction((response, _plan, now) => removeResponse(response, now), {
  done: "removed",
  notice: "removed",
});

/** Undo of a rejection or removal (spec 3.5, decision I37). */
export const restorePerson = personAction(requests.undoRejectionOrRemoval, { done: "restored" });

/** A pending request becomes a participant, before the start only (spec 3.1, 3.4). */
export const acceptRequest = personAction(requests.acceptRequest, {
  done: "accepted",
  notice: "accepted",
});

/** A rejected requester sees what interested people see and cannot request again (spec 3.5). */
export const rejectRequest = personAction(requests.rejectRequest, {
  done: "rejected",
  notice: "rejected",
});
