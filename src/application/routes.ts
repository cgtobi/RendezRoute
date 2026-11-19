// Removing a route on the host page and GPX downloads (spec 5 feature 2, 3.6, decision D10).
// Adding or replacing one is part of saving the edit form (editPlan in host.ts).
import { syncParticipantNotes } from "./participant-notes.ts";
import { editScope } from "../domain/plan-edit.ts";
import type { Route } from "../domain/route.ts";
import { asHost, type Denied, isDenied } from "./host.ts";
import type { PlanDeps } from "./plans.ts";
import { notifyResponders } from "./notify.ts";
import { viewPlan } from "./plans.ts";

type HostRequest = { planId: string; deviceToken: string | undefined };

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
  await syncParticipantNotes(deps, { ...plan, hasRoute: false });
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
