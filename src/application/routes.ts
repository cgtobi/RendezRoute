// Routes on the host page and GPX downloads (spec 5 feature 2, 3.6, decision D10).
import { syncPublication } from "./publishing.ts";
import { editScope, planToInput, validatePlanEdit } from "../domain/plan-edit.ts";
import { applyRouteDefaults, type Route, routeStats } from "../domain/route.ts";
import { asHost, type Denied, isDenied } from "./host.ts";
import type { PlanDeps } from "./plans.ts";
import type { RouteParseError } from "./ports.ts";
import { notifyResponders } from "./notify.ts";
import { readRoute, viewPlan } from "./plans.ts";

type HostRequest = { planId: string; deviceToken: string | undefined };

/** Adds or replaces the route before the start; distance and elevation follow it (decision D10). */
export async function setRoute(
  deps: PlanDeps,
  request: HostRequest & { gpx: Uint8Array; routeTrim?: string | undefined },
): Promise<
  | Denied
  | { kind: "saved" }
  | { kind: "not_allowed" }
  | {
      kind: "invalid";
      code: RouteParseError | "route_too_long" | "route_trimmed_away" | "choice_invalid";
    }
> {
  const plan = await asHost(deps, request.planId, request.deviceToken);
  if (isDenied(plan)) return plan;
  const now = deps.clock.now();
  if (editScope(plan, now) !== "all") return { kind: "not_allowed" };

  const parsed = readRoute(deps, request.gpx, request.routeTrim);
  if (!parsed.ok) return { kind: "invalid", code: parsed.error };
  const input = applyRouteDefaults(
    planToInput(plan, "metric"),
    routeStats(parsed.value),
    "replace",
  );
  const draft = validatePlanEdit(input, plan, { now, ...deps.limits }, "metric");
  if (!draft.ok) return { kind: "invalid", code: "route_too_long" };

  await deps.plans.saveRoute(plan.id, parsed.value);
  const updated = { ...plan, ...draft.value, hasRoute: true, updatedAt: now };
  await deps.plans.update(updated);
  // A new route is a change participants and interested people hear about (spec 3.1).
  await notifyResponders(deps, updated, "changed");
  // A route may set the meeting point, and so move the public one the `Event` shows (D38).
  await syncPublication(deps, plan, updated);
  return { kind: "saved" };
}

/** Removes the route before the start; distance and elevation stay as they are. */
export async function removeRoute(
  deps: PlanDeps,
  request: HostRequest,
): Promise<Denied | { kind: "removed" } | { kind: "not_allowed" }> {
  const plan = await asHost(deps, request.planId, request.deviceToken);
  if (isDenied(plan)) return plan;
  if (editScope(plan, deps.clock.now()) !== "all") return { kind: "not_allowed" };
  await deps.plans.deleteRoute(plan.id);
  await notifyResponders(deps, plan, "changed");
  return { kind: "removed" };
}

/** The route for participants and the host; everyone else gets "not found", like an unknown plan (P4). */
export async function routeForDownload(
  deps: PlanDeps,
  request: HostRequest,
): Promise<{ kind: "found"; title: string; route: Route } | { kind: "not_found" }> {
  const view = await viewPlan(deps, request);
  if (view.kind !== "participant" && view.kind !== "poster") return { kind: "not_found" };
  const route = await deps.plans.findRoute(view.view.id);
  return route === undefined
    ? { kind: "not_found" }
    : { kind: "found", title: view.view.title, route };
}
