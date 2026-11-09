// Plan ratings (spec 6a, decision D20): participants rate the plan while the recap is open, and
// may change or remove their rating until it closes. The host never rates.
import {
  canRate,
  type RatingError,
  ratingsClosed,
  ratingTallyBeforeChange,
  validateRating,
} from "../domain/rating.ts";
import type { Plan } from "../domain/plan.ts";
import type { PlanResponse } from "../domain/response.ts";
import { audienceFor, canSee } from "../domain/visibility.ts";
import { resolveDevice } from "./devices.ts";
import { type Denied, isDenied } from "./host.ts";
import { countedRatings } from "./plan-views.ts";
import type { PlanDeps } from "./plans.ts";

type Request = { planId: string; deviceToken: string | undefined };

/** The plan and the device's own response, if it is a participant's and not the host's. */
async function rater(
  deps: PlanDeps,
  request: Request,
): Promise<{ plan: Plan; response: PlanResponse } | Denied> {
  const plan = await deps.plans.findById(request.planId);
  if (plan === undefined) return { kind: "not_found" };
  const device = await resolveDevice(deps, request.deviceToken);
  if (device === undefined) return { kind: "forbidden" };
  // A device that also holds the host link is the host, as on the plan page.
  if (await deps.devices.hasLink(device.id, { role: "host", planId: plan.id })) {
    return { kind: "forbidden" };
  }
  const response = await deps.responses.findForDevice(plan.id, device.id);
  if (response === undefined || !canSee(audienceFor(response), "ownRating")) {
    return { kind: "forbidden" };
  }
  return { plan, response };
}

/** Rating is open for this participant now, or closed (before the start, after the close). */
const isOpen = (deps: PlanDeps, found: { plan: Plan; response: PlanResponse }) =>
  canRate(found.plan, found.response.kind, deps.clock.now()).ok;

export async function ratePlan(
  deps: PlanDeps,
  request: Request & { value: string; note: string },
): Promise<
  { kind: "saved" } | { kind: "invalid"; errors: RatingError[] } | { kind: "closed" } | Denied
> {
  const found = await rater(deps, request);
  if (isDenied(found)) return found;
  if (!isOpen(deps, found)) return { kind: "closed" };
  const checked = validateRating(request);
  if (!checked.ok) return { kind: "invalid", errors: checked.errors };
  const now = deps.clock.now();
  const existing = await deps.ratings.findByResponse(found.response.id);
  await deps.ratings.save({
    id: existing?.id ?? deps.ids.rowId(),
    planId: found.plan.id,
    responseId: found.response.id,
    ...checked.value,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  return { kind: "saved" };
}

export async function removeRating(
  deps: PlanDeps,
  request: Request,
): Promise<{ kind: "removed" } | { kind: "closed" } | Denied> {
  const found = await rater(deps, request);
  if (isDenied(found)) return found;
  if (!isOpen(deps, found)) return { kind: "closed" };
  await deps.ratings.deleteForResponse(found.response.id);
  return { kind: "removed" };
}

/**
 * Stores the rating counts before anything changes them after the close (a removal, a restored
 * person, a withdrawal, own-data deletion), so the host can never compare tallies around one
 * person (decision D20). Does nothing while ratings are open or once stored.
 */
export async function freezeRatingTally(deps: PlanDeps, plan: Plan): Promise<void> {
  const now = deps.clock.now();
  if (plan.ratingTally !== undefined || !ratingsClosed(plan, now)) return;
  const responses = await deps.responses.listByPlan(plan.id);
  const { participants, counted } = countedRatings(
    await deps.ratings.listByPlan(plan.id),
    responses,
  );
  const ratingTally = ratingTallyBeforeChange(
    plan,
    counted.map((rating) => rating.value),
    participants.length,
    now,
  );
  await deps.plans.update({ ...plan, ratingTally });
}
