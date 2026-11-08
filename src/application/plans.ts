// Plan use cases (spec 5 features 1 and 3).
import { type PlanTheme, planTheme } from "../domain/color.ts";
import type { Units } from "../domain/pace.ts";
import type { Plan } from "../domain/plan.ts";
import { type FieldError, type PlanInput, validatePlanInput } from "../domain/plan-input.ts";
import {
  applyRouteDefaults,
  parseRouteTrim,
  type Route,
  routeStats,
  trimRoute,
} from "../domain/route.ts";
import { canRespond } from "../domain/responding.ts";
import { type DeviceDeps, ensureDevice, resolveDevice } from "./devices.ts";
import {
  type PlanViewForParticipant,
  type PlanViewForPoster,
  type PlanViewForResponder,
  type PlanViewForViewer,
  viewForParticipant,
  viewForPoster,
  viewForResponder,
  viewForViewer,
} from "./plan-views.ts";
import type { Result } from "../domain/result.ts";
import type { PlanRepository, ResponseRepository, RouteParseError, RouteParser } from "./ports.ts";

export interface PlanDeps extends DeviceDeps {
  plans: PlanRepository;
  responses: ResponseRepository;
  routeParser: RouteParser;
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

/** Parses an upload and hides its ends as chosen; trimmed points are never stored (D13). */
export function readRoute(
  deps: Pick<PlanDeps, "routeParser">,
  gpx: Uint8Array,
  routeTrim: string | undefined,
): Result<Route, RouteParseError | "route_trimmed_away" | "choice_invalid"> {
  const trim = parseRouteTrim(routeTrim ?? "");
  if (!trim.ok) return trim;
  const parsed = deps.routeParser.parse(gpx);
  return parsed.ok ? trimRoute(parsed.value, trim.value) : parsed;
}

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
    /** Optional GPX upload; an empty file counts as none (spec 5 feature 2). */
    gpx?: Uint8Array | undefined;
    /** Meters to hide at both ends of the route, as submitted (decision D13). */
    routeTrim?: string | undefined;
  },
): Promise<CreatePlanResult> {
  if (!NONCE.test(request.creationNonce)) return { kind: "bad_request" };
  const existing = await deps.plans.findIdByCreationNonce(request.creationNonce);
  if (existing !== undefined) return { kind: "duplicate", planId: existing };

  let input = request.input;
  let route: Route | undefined;
  if (request.gpx !== undefined && request.gpx.byteLength > 0) {
    const parsed = readRoute(deps, request.gpx, request.routeTrim);
    if (!parsed.ok) return { kind: "invalid", errors: [{ field: "gpx", code: parsed.error }] };
    route = parsed.value;
    input = applyRouteDefaults(input, routeStats(route), "fill");
  }

  const now = deps.clock.now();
  const draft = validatePlanInput(input, { now, ...deps.limits }, request.units);
  if (!draft.ok) {
    // A distance taken from the route is the route's problem, not the empty field's (D7, D10).
    const distanceFromRoute = route !== undefined && request.input.distanceKm.trim() === "";
    const errors = draft.errors.map((error) =>
      distanceFromRoute && error.field === "distanceKm"
        ? { field: "gpx" as const, code: "route_too_long" }
        : error,
    );
    return { kind: "invalid", errors };
  }

  const hostToken = deps.tokens.generate();
  const { device, newToken } = await ensureDevice(deps, request.deviceToken);
  const plan: Plan = {
    ...draft.value,
    id: deps.ids.planId(),
    posterLanguage: request.language,
    visibility: "link",
    joinMode: "open",
    status: "active",
    hasRoute: route !== undefined,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await deps.plans.create({
      plan,
      hostTokenHash: deps.tokens.hash(hostToken),
      creationNonce: request.creationNonce,
      hostDeviceId: device.id,
      route,
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

/** Whether new responses and switches are possible now (spec 3.1 Responding). */
type Open = { responsesOpen: boolean };

export type ViewPlanResult =
  | { kind: "not_found" }
  | ({ kind: "viewer"; view: PlanViewForViewer } & Open)
  | ({ kind: "responder"; view: PlanViewForResponder } & Open)
  | ({ kind: "participant"; view: PlanViewForParticipant } & Open)
  | ({ kind: "poster"; view: PlanViewForPoster } & Open);

/** The plan as the requesting device may see it (spec 3.6). */
export async function viewPlan(
  deps: PlanDeps,
  request: { planId: string; deviceToken: string | undefined },
): Promise<ViewPlanResult> {
  const plan = await deps.plans.findById(request.planId);
  if (plan === undefined) return { kind: "not_found" };
  const counts = await deps.responses.counts(plan.id);
  const responsesOpen = canRespond(plan, deps.clock.now()).ok;
  const device = await resolveDevice(deps, request.deviceToken);
  if (device === undefined)
    return { kind: "viewer", view: viewForViewer(plan, counts), responsesOpen };

  if (await deps.devices.hasLink(device.id, { role: "host", planId: plan.id })) {
    const responses = await deps.responses.listByPlan(plan.id);
    return { kind: "poster", view: viewForPoster(plan, counts, responses), responsesOpen };
  }
  const own = await deps.responses.findForDevice(plan.id, device.id);
  if (own === undefined)
    return { kind: "viewer", view: viewForViewer(plan, counts), responsesOpen };
  if (own.kind === "joined") {
    const responses = await deps.responses.listByPlan(plan.id);
    return {
      kind: "participant",
      view: viewForParticipant(plan, counts, own, responses),
      responsesOpen,
    };
  }
  return { kind: "responder", view: viewForResponder(plan, counts, own), responsesOpen };
}

/** The plan's colors for its theme stylesheet; public data (spec 3.1). */
export async function viewPlanTheme(
  deps: PlanDeps,
  request: { planId: string },
): Promise<{ kind: "found"; theme: PlanTheme } | { kind: "not_found" }> {
  const plan = await deps.plans.findById(request.planId);
  return plan === undefined
    ? { kind: "not_found" }
    : { kind: "found", theme: planTheme(plan.colors) };
}
