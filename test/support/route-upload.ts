import { editPlan, type EditPlanResult } from "../../src/application/host.ts";
import type { PlanDeps } from "../../src/application/plans.ts";
import { planToInput } from "../../src/domain/plan-edit.ts";
import { sampleInput } from "../fixtures/plans.ts";

/**
 * A route uploaded on the host page: the edit form saved unchanged, with a file (decision D10).
 * The plan's own values are submitted, so distance and elevation follow the route.
 */
export async function uploadRoute(
  deps: PlanDeps,
  request: {
    planId: string;
    deviceToken: string | undefined;
    gpx: Uint8Array;
    routeTrim?: string;
  },
): Promise<EditPlanResult> {
  const plan = await deps.plans.findById(request.planId);
  return editPlan(deps, {
    planId: request.planId,
    deviceToken: request.deviceToken,
    input: plan === undefined ? sampleInput : planToInput(plan, "metric"),
    units: "metric",
    confirmDeleteNow: false,
    route: { gpx: request.gpx, trim: request.routeTrim ?? "" },
  });
}
