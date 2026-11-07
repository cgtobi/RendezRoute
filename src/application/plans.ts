// Plan use cases (spec 5 features 1 and 3).
import type { Units } from "../domain/pace.ts";
import type { Plan } from "../domain/plan.ts";
import { type FieldError, type PlanInput, validatePlanInput } from "../domain/plan-input.ts";
import { type DeviceDeps, ensureDevice, resolveDevice } from "./devices.ts";
import {
  type PlanViewForPoster,
  type PlanViewForViewer,
  viewForPoster,
  viewForViewer,
} from "./plan-views.ts";
import type { PlanRepository } from "./ports.ts";

export interface PlanDeps extends DeviceDeps {
  plans: PlanRepository;
  limits: { horizonDays: number; maxRetentionDays: number };
}

const NONCE = /^[A-Za-z0-9_-]{16,64}$/;

export type CreatePlanResult =
  | {
      kind: "created";
      planId: string;
      hostToken: string;
      newDeviceToken: string | undefined;
      deleteAt: Date;
      /** Canonical IANA zone of the plan, for displaying dates. */
      timeZone: string;
    }
  | { kind: "duplicate"; planId: string }
  | { kind: "invalid"; errors: FieldError[] }
  | { kind: "bad_request" };

export async function createPlan(
  deps: PlanDeps,
  request: {
    input: PlanInput;
    units: Units;
    /** BCP 47 tag negotiated from the browser (decision P7). */
    language: string;
    /** One-time value from the form (decision I9). */
    creationNonce: string;
    deviceToken: string | undefined;
  },
): Promise<CreatePlanResult> {
  if (!NONCE.test(request.creationNonce)) return { kind: "bad_request" };
  const existing = await deps.plans.findIdByCreationNonce(request.creationNonce);
  if (existing !== undefined) return { kind: "duplicate", planId: existing };

  const now = deps.clock.now();
  const draft = validatePlanInput(request.input, { now, ...deps.limits }, request.units);
  if (!draft.ok) return { kind: "invalid", errors: draft.errors };

  const hostToken = deps.tokens.generate();
  const { device, newToken } = await ensureDevice(deps, request.deviceToken);
  const plan: Plan = {
    ...draft.value,
    id: deps.ids.planId(),
    posterLanguage: request.language,
    visibility: "link",
    joinMode: "open",
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  try {
    await deps.plans.create({
      plan,
      hostTokenHash: deps.tokens.hash(hostToken),
      creationNonce: request.creationNonce,
      hostDeviceId: device.id,
    });
  } catch (error) {
    // A concurrent submit of the same form won the race (nonce is unique).
    const winner = await deps.plans.findIdByCreationNonce(request.creationNonce);
    if (winner !== undefined) return { kind: "duplicate", planId: winner };
    throw error;
  }

  return {
    kind: "created",
    planId: plan.id,
    hostToken,
    newDeviceToken: newToken,
    deleteAt: plan.deleteAt,
    timeZone: plan.timeZone,
  };
}

export type ViewPlanResult =
  | { kind: "not_found" }
  | { kind: "viewer"; view: PlanViewForViewer }
  | { kind: "poster"; view: PlanViewForPoster };

export async function viewPlan(
  deps: PlanDeps,
  request: { planId: string; deviceToken: string | undefined },
): Promise<ViewPlanResult> {
  const plan = await deps.plans.findById(request.planId);
  if (plan === undefined) return { kind: "not_found" };
  const device = await resolveDevice(deps, request.deviceToken);
  if (device !== undefined && (await deps.devices.isHost(device.id, plan.id))) {
    return { kind: "poster", view: viewForPoster(plan) };
  }
  return { kind: "viewer", view: viewForViewer(plan) };
}
