// The host page: edit, cancel, delete, remove and restore people (spec 5 features 7–9,
// 3.1 Editing and Retention edits, 3.5, decision D8). Only devices linked as host may act.
import {
  federatedAtFor,
  type VisibilityChoices,
  visibilityChoices,
  visibilityRefused,
} from "./public-plans.ts";
import { syncPublication } from "./publishing.ts";
import type { Units } from "../domain/pace.ts";
import type { NotificationKind } from "../domain/notification.ts";
import type { Plan } from "../domain/plan.ts";
import {
  canCancel,
  editScope,
  isMaterialChange,
  planToInput,
  removeResponse,
  routeFieldsTyped,
  validatePlanEdit,
  validateRetentionEdit,
} from "../domain/plan-edit.ts";
import type { FieldError, PlanDraft, PlanInput, Validation } from "../domain/plan-input.ts";
import { applyRouteDefaults, type Route, routeStats } from "../domain/route.ts";
import { ratingsClosed, ratingsClosedAtAfter } from "../domain/rating.ts";
import { hasRecap, shortenedRecapWindow } from "../domain/recap.ts";
import type { RecapWindow } from "../domain/schedule.ts";
import * as requests from "../domain/requests.ts";
import { canRespond } from "../domain/responding.ts";
import { isPosterName } from "../domain/responding.ts";
import type { PlanResponse } from "../domain/response.ts";
import type { Result } from "../domain/result.ts";
import { resolveDevice } from "./devices.ts";
import { withdrawNotesOfAuthor, withdrawNotesOfPlanContributions } from "./contribution-notes.ts";
import { deletionNotices, notifyResponders, notifyResponse } from "./notify.ts";
import { syncNoteOf, syncParticipantNotes } from "./participant-notes.ts";
import { answerRemoteResponse } from "./remote-participants.ts";
import { ratingRulesFor } from "./rating-rules.ts";
import { ratingResultDue, ratingResultFor, type RatingResultView } from "./plan-views.ts";
import { freezeRatingTally } from "./ratings.ts";
import { type PlanDeps, readRoute } from "./plans.ts";
import { deletePlansKeepingTemplates } from "./templates.ts";

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

export const isDenied = <T extends object>(value: T | Denied): value is Denied =>
  "kind" in value && (value.kind === "not_found" || value.kind === "forbidden");

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
      /** What the edit form may offer for who can find the plan (decisions D35, D37). */
      visibility: VisibilityChoices;
      scope: "all" | "retention";
      canCancel: boolean;
      /** Whether pending requests can still be decided: before the start of an active plan (spec 3.1). */
      requestsOpen: boolean;
      hasRoute: boolean;
      /** Contributions in the recap, from the start of an active plan on (spec 6 feature 7). */
      recapContributions: number | undefined;
      /** From the start of an active plan on (spec 6a): whether ratings closed, and the result once due. */
      rating:
        | { closed: boolean; result: RatingResultView | undefined; minimum: number }
        | undefined;
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
  const ratingRules = await ratingRulesFor(deps, plan.id);
  const people = (kind: "joined" | "interested" | "rejected" | "removed") =>
    responses
      .filter((r) => r.kind === kind)
      .map((r) => ({ responseId: r.id, name: r.displayName }));
  return {
    kind: "found",
    planId: plan.id,
    title: plan.title,
    input: planToInput(plan, request.units),
    visibility: await visibilityChoices(deps, { plan }),
    scope: editScope(plan, now),
    canCancel: canCancel(plan, now).ok,
    requestsOpen: canRespond(plan, now).ok,
    hasRoute: plan.hasRoute,
    recapContributions: hasRecap(plan, now) ? await deps.recap.countByPlan(plan.id) : undefined,
    rating: hasRecap(plan, now)
      ? {
          closed: ratingsClosed(plan, now),
          minimum: ratingRules.minimum,
          // Notes are decrypted only once the result is due (decision D20).
          result: ratingResultDue(plan, responses, now, ratingRules)
            ? ratingResultFor(
                plan,
                await deps.ratings.listByPlan(plan.id),
                responses,
                now,
                ratingRules,
              )
            : undefined,
        }
      : undefined,
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
  /** With the recap window, if the chosen one was shortened to fit the retention (spec 3.10). */
  | { kind: "updated"; recapWindowShortened: RecapWindow | undefined }
  | { kind: "invalid"; errors: FieldError[] }
  /** The retention edit would delete the plan now; ask "This will delete the plan now" first. */
  | { kind: "confirm_delete_now" }
  /** Switching to open mode accepts pending requests; ask "N pending requests will be accepted" first (spec 3.4). */
  | { kind: "confirm_accept_pending"; count: number }
  | { kind: "deleted" }
  /** A route came with an edit after the start: routes change only before it; nothing was saved. */
  | { kind: "not_allowed" };

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
    /**
     * A GPX file chosen in the same form, with the submitted "hide start and end" choice (D10,
     * D13); an empty file counts as none. The whole save is refused if it cannot be used.
     */
    route?: { gpx: Uint8Array; trim: string } | undefined;
  },
): Promise<EditPlanResult> {
  const plan = await asHost(deps, request.planId, request.deviceToken);
  if (isDenied(plan)) return plan;
  const now = deps.clock.now();
  // An empty file counts as none.
  const upload =
    request.route !== undefined && request.route.gpx.byteLength > 0 ? request.route : undefined;

  if (editScope(plan, now) === "retention") {
    // The route changes only before the start; the retention edit is not saved without it either.
    if (upload !== undefined) return { kind: "not_allowed" };
    const edit = validateRetentionEdit(request.input, plan, now, deps.limits.maxRetentionDays);
    if (!edit.ok) return { kind: "invalid", errors: edit.errors };
    if (edit.value.deletesNow) {
      if (!request.confirmDeleteNow) return { kind: "confirm_delete_now" };
      // Same path as retention deletion: a template is kept if asked for, in this form too (spec 3.10).
      await deletePlansKeepingTemplates(deps, [{ ...plan, template: edit.value.template }]);
      return { kind: "deleted" };
    }
    const { template, retentionDays, recapWindow, recapWindowSetAt, recapClosedAt, deleteAt } =
      edit.value;
    await deps.plans.update({
      ...plan,
      // A recap that had closed keeps ratings closed, even if this reopens it (decision D20).
      ratingsClosedAt: ratingsClosedAtAfter(plan, now),
      template,
      retentionDays,
      recapWindow,
      recapWindowSetAt,
      recapClosedAt,
      deleteAt,
      updatedAt: now,
    });
    return {
      kind: "updated",
      recapWindowShortened: shortenedRecapWindow(request.input.recapWindow, recapWindow),
    };
  }

  // The form first: parsing a large file is the costly part (as when creating).
  const draft = validatePlanEdit(request.input, plan, { now, ...deps.limits }, request.units);
  if (!draft.ok) return { kind: "invalid", errors: draft.errors };
  const choices = await visibilityChoices(deps, { plan });
  const refused = visibilityRefused(draft.value.visibility, choices);
  if (refused !== undefined) return { kind: "invalid", errors: refused };
  const responses = await deps.responses.listByPlan(plan.id);
  if (responses.some((response) => isPosterName(response.displayName, draft.value.posterName))) {
    return { kind: "invalid", errors: [{ field: "posterName", code: "name_taken_by_response" }] };
  }
  // Approval → open accepts pending requests; the host confirms exactly how many (spec 3.4).
  const pending = requests.requestsAcceptedBySwitch(plan.joinMode, draft.value.joinMode, responses);
  if (pending.length > 0 && request.confirmAcceptPending !== pending.length) {
    return { kind: "confirm_accept_pending", count: pending.length };
  }
  let edited = draft.value;
  let route: Route | undefined;
  if (upload !== undefined) {
    const withRoute = editWithRoute(deps, plan, { ...request, now }, upload, edited);
    if (!withRoute.ok) return { kind: "invalid", errors: withRoute.errors };
    ({ route, draft: edited } = withRoute.value);
  }
  const updated: Plan = {
    ...plan,
    ...edited,
    hasRoute: plan.hasRoute || route !== undefined,
    federatedAt: federatedAtFor(edited.visibility, choices, plan.federatedAt, now),
    updatedAt: now,
  };
  // With a route, both are stored in one transaction, or neither (decision D10).
  if (route === undefined) await deps.plans.update(updated);
  else await deps.plans.updateWithRoute(updated, route);
  for (const response of pending) {
    const accepted = requests.acceptRequest(response, plan, now);
    if (accepted.ok) {
      await deps.responses.update(accepted.value);
      await notifyResponse(deps, updated, accepted.value, "accepted");
      await answerRemoteResponse(deps, updated, accepted.value, "accept");
      await syncNoteOf(deps, updated, response.id, response.kind, accepted.value.kind);
    }
  }
  // A new route is a change participants and interested people hear about (spec 3.1), once.
  if (route !== undefined || isMaterialChange(plan, updated)) {
    await notifyResponders(deps, updated, "changed");
  }
  // Last, so people here are told even if the fediverse cannot be (D38).
  await syncPublication(deps, plan, updated);
  // And the private Notes of remote participants, if the exact start, the time or the route
  // changed (D43).
  await syncParticipantNotes(deps, updated);
  return {
    kind: "updated",
    recapWindowShortened: shortenedRecapWindow(request.input.recapWindow, updated.recapWindow),
  };
}

/**
 * The edit with a route uploaded in the same save (decisions D10, D13, D40): the file is cut at
 * the meeting point of this submission and its ends hidden as chosen, and distance and elevation
 * follow it unless the host changed them in this save. What is cut or hidden is never stored.
 * Validated at the same instant as the form, so both passes agree on what may change.
 */
function editWithRoute(
  deps: PlanDeps,
  plan: Plan,
  request: { input: PlanInput; units: Units; now: Date },
  upload: { gpx: Uint8Array; trim: string },
  edited: PlanDraft,
): Validation<{ route: Route; draft: PlanDraft }> {
  const parsed = readRoute(deps, upload.gpx, {
    routeTrim: upload.trim,
    meetingPoint: edited.exactStart?.point,
  });
  if (!parsed.ok) return { ok: false, errors: [{ field: "gpx", code: parsed.error }] };
  const typed = routeFieldsTyped(request.input, plan, request.units);
  const input = applyRouteDefaults(request.input, routeStats(parsed.value), {
    units: request.units,
    replace: { distance: !typed.distance, elevation: !typed.elevation },
  });
  const draft = validatePlanEdit(input, plan, { now: request.now, ...deps.limits }, request.units);
  if (!draft.ok) {
    // A distance taken from the route is the route's problem, not the field's (D7, D10).
    const distanceFromRoute = input.distanceKm !== request.input.distanceKm;
    return {
      ok: false,
      errors: draft.errors.map((error) =>
        distanceFromRoute && error.field === "distanceKm"
          ? { field: "gpx", code: "route_too_long" }
          : error,
      ),
    };
  }
  return { ok: true, value: { route: parsed.value, draft: draft.value } };
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
  // The web hides the recap of a cancelled plan, so its contributions' Notes are withdrawn too.
  await withdrawNotesOfPlanContributions(deps, cancelled);
  await notifyResponders(deps, cancelled, "cancelled");
  // Said in the fediverse too, as an `Update` (spec 7), once people here were told.
  await syncPublication(deps, plan, cancelled);
  return { kind: "cancelled" };
}

/** Hard delete (spec 1.6), telling everyone still in if the plan was upcoming (spec 3.10). */
export async function deletePlan(
  deps: PlanDeps,
  request: { planId: string; deviceToken: string | undefined },
): Promise<Denied | { kind: "deleted" }> {
  const plan = await asHost(deps, request.planId, request.deviceToken);
  if (isDenied(plan)) return plan;
  const sendNotices = await deletionNotices(deps, plan);
  await deletePlansKeepingTemplates(deps, [plan]);
  await sendNotices();
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
    deletesContributions = false,
    answer,
  }: {
    /** The result's kind. */
    done: Done;
    /** What the person is told (spec 3.5: one notice on rejection or removal). */
    notice?: NotificationKind;
    /** Removal deletes the person's recap contributions and rating (spec 3.5, 6a). */
    deletesContributions?: boolean;
    /** What a remote participant is told (decision D42); sent last, once the change is stored. */
    answer?: (changed: PlanResponse) => "accept" | "reject" | undefined;
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
    // A changed participant list after the close must not change the host's counts (D20).
    await freezeRatingTally(deps, plan);
    await deps.responses.update(changed.value);
    if (deletesContributions) {
      // What they wrote goes from remote participants too, before it is deleted (decision D44).
      await withdrawNotesOfAuthor(deps, plan, response.id);
      await deps.recap.deleteForResponse(response.id);
      await deps.ratings.deleteForResponse(response.id);
    }
    if (notice !== undefined) await notifyResponse(deps, plan, changed.value, notice);
    const told = answer?.(changed.value);
    if (told !== undefined) await answerRemoteResponse(deps, plan, changed.value, told);
    // The exact start and route follow the answer, to those who joined (decision D43).
    await syncNoteOf(deps, plan, response.id, response.kind, changed.value.kind);
    return { kind: done };
  };
}

/** Removal works like rejection: no private details, no new response from that device (spec 3.5). */
export const removePerson = personAction((response, _plan, now) => removeResponse(response, now), {
  done: "removed",
  notice: "removed",
  deletesContributions: true,
  answer: () => "reject",
});

/** Undo of a rejection or removal (spec 3.5, decision I37). */
export const restorePerson = personAction(requests.undoRejectionOrRemoval, {
  done: "restored",
  // A remote participant is told it is in again; only a pending request stays unanswered.
  answer: (changed) => (changed.kind === "requested" ? undefined : "accept"),
});

/** A pending request becomes a participant, before the start only (spec 3.1, 3.4). */
export const acceptRequest = personAction(requests.acceptRequest, {
  done: "accepted",
  notice: "accepted",
  answer: () => "accept",
});

/** A rejected requester sees what interested people see and cannot request again (spec 3.5). */
export const rejectRequest = personAction(requests.rejectRequest, {
  done: "rejected",
  notice: "rejected",
  answer: () => "reject",
});
