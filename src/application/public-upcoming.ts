// The home page's list of upcoming public plans (spec 7 Visibility and Nearby plans): the next
// few by start, anywhere, with the same public fields as Nearby and no distance from the viewer.
import type { Plan } from "../domain/plan.ts";
import type { PlanDeps } from "./plans.ts";
import type { NearbyItem } from "./nearby.ts";

/** Listed at most; no paging. */
export const MAX_UPCOMING = 10;
/** Recent plans: at most this many, that started within this many days. */
export const MAX_RECENT = 5;
const RECENT_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What a viewer sees of a public plan in the list: Nearby's fields without the viewer's distance. */
export type PublicUpcomingItem = Omit<NearbyItem, "awayKm">;

/** Upcoming public plans within the plan horizon, soonest first. */
export async function listPublicUpcoming(
  deps: Pick<PlanDeps, "plans" | "clock" | "limits">,
): Promise<PublicUpcomingItem[]> {
  const now = deps.clock.now();
  const until = new Date(now.getTime() + deps.limits.horizonDays * DAY_MS);
  const plans = await deps.plans.findPublicUpcoming(now, until, MAX_UPCOMING);
  return publicItems(plans, (plan) => plan.startsAt.getTime() >= now.getTime(), MAX_UPCOMING);
}

/** Public plans that started within the last week, newest first. */
export async function listPublicRecent(
  deps: Pick<PlanDeps, "plans" | "clock">,
): Promise<PublicUpcomingItem[]> {
  const now = deps.clock.now();
  const from = new Date(now.getTime() - RECENT_DAYS * DAY_MS);
  const plans = await deps.plans.findPublicRecent(from, now, MAX_RECENT);
  return publicItems(plans, (plan) => plan.startsAt.getTime() < now.getTime(), MAX_RECENT);
}

/** The same conditions as matchesNearby, except the time rule, which the caller gives. */
function publicItems(
  plans: readonly Plan[],
  timeRule: (plan: Plan) => boolean,
  max: number,
): PublicUpcomingItem[] {
  return plans
    .filter(
      (plan) =>
        plan.visibility === "public" &&
        plan.status === "active" &&
        plan.area.point !== undefined &&
        timeRule(plan),
    )
    .slice(0, max)
    .map((plan): PublicUpcomingItem => ({
      planId: plan.id,
      title: plan.title,
      activity: plan.activity,
      startsAt: plan.startsAt,
      timeZone: plan.timeZone,
      areaLabel: plan.area.label,
      distanceMeters: plan.distanceMeters,
      elevationGainMeters: plan.elevationGainMeters,
      pace: plan.pace,
    }));
}
