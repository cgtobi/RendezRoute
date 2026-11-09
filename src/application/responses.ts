// Responding and managing one's own response (spec 5 features 5 and 6, 3.5).
import type { Plan } from "../domain/plan.ts";
import { isBlocked, type PlanResponse } from "../domain/response.ts";
import type { FieldError } from "../domain/result.ts";
import {
  choicesFor,
  isResponseChoice,
  type ResponseChoice,
  validateRequestNote,
} from "../domain/requests.ts";
import { canChangeResponse, canRespond, validateDisplayName } from "../domain/responding.ts";
import { ensureDevice, resolveDevice } from "./devices.ts";
import { notifyHost, notifyHostOfArrival } from "./notify.ts";
import { type OwnResponseView, ownResponse as ownResponseView } from "./plan-views.ts";
import type { PlanDeps } from "./plans.ts";

const NONCE = /^[A-Za-z0-9_-]{16,64}$/;

type Closed = { kind: "closed"; reason: "plan_started" | "plan_cancelled" };
type Invalid = { kind: "invalid"; errors: FieldError<"displayName" | "requestNote">[] };

export type RespondResult =
  | {
      kind: "created";
      planId: string;
      manageToken: string;
      newDeviceToken: string | undefined;
      /** For the join confirmation (spec 3.10: the deletion date is visible there). */
      deleteAt: Date;
      timeZone: string;
    }
  | { kind: "duplicate"; planId: string }
  | { kind: "already_responded"; planId: string }
  | { kind: "is_host" }
  | { kind: "blocked" }
  | Closed
  | Invalid
  | { kind: "not_found" }
  | { kind: "bad_request" };

export async function respond(
  deps: PlanDeps,
  request: {
    planId: string;
    /** "interested", plus "joined" in open mode or "requested" in approval mode. */
    choice: string;
    displayName: string;
    /** Optional, with a request only (spec 6 feature 1). */
    requestNote?: string | undefined;
    language: string;
    /** One-time value from the response form. */
    creationNonce: string;
    deviceToken: string | undefined;
  },
): Promise<RespondResult> {
  if (!NONCE.test(request.creationNonce)) return { kind: "bad_request" };
  const plan = await deps.plans.findById(request.planId);
  if (plan === undefined) return { kind: "not_found" };
  if (await deps.responses.findIdByCreationNonce(request.creationNonce))
    return { kind: "duplicate", planId: plan.id };
  const noteText = request.requestNote ?? "";
  if (!isResponseChoice(request.choice, plan.joinMode)) return { kind: "bad_request" };
  if (request.choice !== "requested" && noteText.trim() !== "") return { kind: "bad_request" };

  const existingDevice = await resolveDevice(deps, request.deviceToken);
  if (existingDevice !== undefined) {
    if (await deps.devices.hasLink(existingDevice.id, { role: "host", planId: plan.id }))
      return { kind: "is_host" };
    if (await deps.responses.isBlocked(plan.id, existingDevice.id)) return { kind: "blocked" };
    if (await deps.responses.findForDevice(plan.id, existingDevice.id)) {
      return { kind: "already_responded", planId: plan.id };
    }
  }

  const now = deps.clock.now();
  const open = canRespond(plan, now);
  if (!open.ok) return { kind: "closed", reason: open.error };

  const name = validateDisplayName(request.displayName, plan.posterName);
  const note = validateRequestNote(noteText);
  if (!name.ok || !note.ok) {
    return {
      kind: "invalid",
      errors: [
        ...(name.ok ? [] : [{ field: "displayName" as const, code: name.error }]),
        ...(note.ok ? [] : [{ field: "requestNote" as const, code: note.error }]),
      ],
    };
  }

  const manageToken = deps.tokens.generate();
  const { device, newToken } = await ensureDevice(deps, request.deviceToken);
  const response: PlanResponse = {
    id: deps.ids.rowId(),
    planId: plan.id,
    kind: request.choice,
    displayName: name.value,
    requestNote: note.value,
    language: request.language,
    previousKind: undefined,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await deps.responses.create({
      response,
      manageTokenHash: deps.tokens.hash(manageToken),
      creationNonce: request.creationNonce,
      deviceId: device.id,
    });
  } catch (error) {
    // A concurrent submit of the same form won the race (nonce is unique).
    if (await deps.responses.findIdByCreationNonce(request.creationNonce))
      return { kind: "duplicate", planId: plan.id };
    throw error;
  }
  await notifyHostOfArrival(deps, plan, request.choice);
  return {
    kind: "created",
    planId: plan.id,
    manageToken,
    newDeviceToken: newToken,
    deleteAt: plan.deleteAt,
    timeZone: plan.timeZone,
  };
}

/** The device's response to a plan, if it manages one. */
async function ownResponse(deps: PlanDeps, planId: string, deviceToken: string | undefined) {
  const device = await resolveDevice(deps, deviceToken);
  if (device === undefined) return undefined;
  const plan = await deps.plans.findById(planId);
  if (plan === undefined) return undefined;
  const response = await deps.responses.findForDevice(plan.id, device.id);
  return response === undefined ? undefined : { plan, response };
}

export type ViewMyResponseResult =
  | { kind: "not_found" }
  | {
      kind: "found";
      planTitle: string;
      startsAt: Date;
      timeZone: string;
      response: OwnResponseView;
      /** Whether changing the response is still possible. */
      canChange: boolean;
      /** The kinds the response can be set to: this join mode's choices, plus the current one (spec 3.4). */
      choices: readonly ResponseChoice[];
    };

export async function viewMyResponse(
  deps: PlanDeps,
  request: { planId: string; deviceToken: string | undefined },
): Promise<ViewMyResponseResult> {
  const found = await ownResponse(deps, request.planId, request.deviceToken);
  if (found === undefined) return { kind: "not_found" };
  const { plan, response } = found;
  return {
    kind: "found",
    planTitle: plan.title,
    startsAt: plan.startsAt,
    timeZone: plan.timeZone,
    response: ownResponseView(response, plan, deps.clock.now()),
    canChange: canChangeResponse(response, plan, deps.clock.now()).ok,
    // An accepted participant in approval mode keeps "joined" next to the mode's choices.
    choices: choicesFor(plan.joinMode, response.kind),
  };
}

export type UpdateMyResponseResult =
  /** notifiedHost: the change was news for the host (a join or request). */
  | { kind: "updated"; notifiedHost: boolean }
  /** The change would notify the host, but the caller's limit for that is used up. */
  | { kind: "limited" }
  | { kind: "blocked" }
  | Closed
  | Invalid
  | { kind: "not_found" }
  | { kind: "bad_request" };

/** Changes the choice (interested ↔ joined, before the start) and the display name. */
export async function updateMyResponse(
  deps: PlanDeps,
  request: {
    planId: string;
    deviceToken: string | undefined;
    choice: string;
    displayName: string;
    /** False once the caller's rate limit is used up: joining or requesting is refused then. */
    mayNotifyHost?: boolean;
  },
): Promise<UpdateMyResponseResult> {
  const found = await ownResponse(deps, request.planId, request.deviceToken);
  if (found === undefined) return { kind: "not_found" };
  const { plan, response } = found;
  if (isBlocked(response.kind)) return { kind: "blocked" };
  if (!isResponseChoice(request.choice, plan.joinMode, response.kind)) {
    return { kind: "bad_request" };
  }

  const now = deps.clock.now();
  if (request.choice !== response.kind) {
    const allowed = canChangeResponse(response, plan, now);
    if (!allowed.ok)
      return allowed.error === "blocked"
        ? { kind: "blocked" }
        : { kind: "closed", reason: allowed.error };
  }
  const name = validateDisplayName(request.displayName, plan.posterName);
  if (!name.ok) return { kind: "invalid", errors: [{ field: "displayName", code: name.error }] };
  // Joining or requesting through the manage page is news for the host, like a new response.
  const notifiedHost = request.choice !== response.kind && request.choice !== "interested";
  if (notifiedHost && request.mayNotifyHost === false) return { kind: "limited" };

  await deps.responses.update({
    ...response,
    kind: request.choice,
    // A note belongs to a pending request; it goes when the person stops requesting (spec 3.6).
    requestNote: request.choice === "requested" ? response.requestNote : undefined,
    displayName: name.value,
    updatedAt: now,
  });
  if (notifiedHost) await notifyHostOfArrival(deps, plan, request.choice);
  return { kind: "updated", notifiedHost };
}

/** Hard delete of the response, its name and any block on it (spec 3.5 Blocks and erasure). */
export async function withdrawMyResponse(
  deps: PlanDeps,
  request: { planId: string; deviceToken: string | undefined },
): Promise<{ kind: "withdrawn" } | { kind: "not_found" }> {
  const found = await ownResponse(deps, request.planId, request.deviceToken);
  if (found === undefined) return { kind: "not_found" };
  await withdrawResponse(deps, found.plan, found.response);
  return { kind: "withdrawn" };
}

/**
 * Deletes a response; the host is told, unless they had rejected or removed the person, for whom
 * a withdrawal is no news (decision I45).
 */
export async function withdrawResponse(
  deps: PlanDeps,
  plan: Plan,
  response: PlanResponse,
): Promise<void> {
  await deps.responses.delete(response.id);
  if (!isBlocked(response.kind)) await notifyHost(deps, plan, "withdrawn");
}
