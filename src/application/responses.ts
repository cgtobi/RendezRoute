// Responding and managing one's own response (spec 5 features 5 and 6, 3.5).
import type { PlanResponse } from "../domain/response.ts";
import type { FieldError } from "../domain/result.ts";
import {
  canChangeResponse,
  canRespond,
  OPEN_MODE_CHOICES,
  type OpenModeChoice,
  validateDisplayName,
} from "../domain/responding.ts";
import { ensureDevice, resolveDevice } from "./devices.ts";
import type { OwnResponseView } from "./plan-views.ts";
import type { PlanDeps } from "./plans.ts";

const NONCE = /^[A-Za-z0-9_-]{16,64}$/;

type Closed = { kind: "closed"; reason: "plan_started" | "plan_cancelled" };
type Invalid = { kind: "invalid"; errors: FieldError<"displayName">[] };

const isOpenModeChoice = (choice: string): choice is OpenModeChoice =>
  (OPEN_MODE_CHOICES as readonly string[]).includes(choice);

export type RespondResult =
  | { kind: "created"; planId: string; manageToken: string; newDeviceToken: string | undefined }
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
    /** "interested" or "joined" in open mode. */
    choice: string;
    displayName: string;
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
  if (plan.joinMode !== "open" || !isOpenModeChoice(request.choice)) return { kind: "bad_request" };

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
  if (!name.ok) return { kind: "invalid", errors: [{ field: "displayName", code: name.error }] };

  const manageToken = deps.tokens.generate();
  const { device, newToken } = await ensureDevice(deps, request.deviceToken);
  const response: PlanResponse = {
    id: deps.ids.rowId(),
    planId: plan.id,
    kind: request.choice,
    displayName: name.value,
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
  return { kind: "created", planId: plan.id, manageToken, newDeviceToken: newToken };
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
      /** Whether switching between interested and joined is still possible. */
      canChange: boolean;
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
    response: { kind: response.kind, displayName: response.displayName },
    canChange: canChangeResponse(response, plan, deps.clock.now()).ok,
  };
}

export type UpdateMyResponseResult =
  | { kind: "updated" }
  | { kind: "blocked" }
  | Closed
  | Invalid
  | { kind: "not_found" }
  | { kind: "bad_request" };

/** Changes the choice (interested ↔ joined, before the start) and the display name. */
export async function updateMyResponse(
  deps: PlanDeps,
  request: { planId: string; deviceToken: string | undefined; choice: string; displayName: string },
): Promise<UpdateMyResponseResult> {
  const found = await ownResponse(deps, request.planId, request.deviceToken);
  if (found === undefined) return { kind: "not_found" };
  const { plan, response } = found;
  if (response.kind === "removed" || response.kind === "rejected") return { kind: "blocked" };
  if (!isOpenModeChoice(request.choice)) return { kind: "bad_request" };

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

  await deps.responses.update({
    ...response,
    kind: request.choice,
    displayName: name.value,
    updatedAt: now,
  });
  return { kind: "updated" };
}

/** Hard delete of the response, its name and any block on it (spec 3.5 Blocks and erasure). */
export async function withdrawMyResponse(
  deps: PlanDeps,
  request: { planId: string; deviceToken: string | undefined },
): Promise<{ kind: "withdrawn" } | { kind: "not_found" }> {
  const found = await ownResponse(deps, request.planId, request.deviceToken);
  if (found === undefined) return { kind: "not_found" };
  await deps.responses.delete(found.response.id);
  return { kind: "withdrawn" };
}
