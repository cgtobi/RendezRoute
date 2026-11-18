// The home page's list of the visitor's own plans: those the device (or its account) hosts, and
// those it joined, asked to join or is interested in. Only what the person already knows: a
// title, the start and how they relate to the plan; never the exact start, names, notes or route.
import type { ResponseKind } from "../domain/response.ts";
import { lookupDevice } from "./devices.ts";
import type { PlanDeps } from "./plans.ts";

/** Listed at most under "Coming up". */
export const MAX_COMING_UP = 10;
/** Listed at most under "Recently". */
export const MAX_RECENT = 5;
const RECENT_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** How the visitor relates to the plan. */
export type MyPlanRole = "host" | "joined" | "interested" | "requested";

export interface MyPlanItem {
  planId: string;
  title: string;
  startsAt: Date;
  timeZone: string;
  role: MyPlanRole;
}

export interface MyPlans {
  /** Starting now or later, soonest first. */
  upcoming: MyPlanItem[];
  /** Started within the last week, newest first. */
  recent: MyPlanItem[];
}

/** Blocked kinds (rejected, removed) are not listed; a new kind must be placed here. */
const ROLE_OF = {
  interested: "interested",
  requested: "requested",
  joined: "joined",
  rejected: undefined,
  removed: undefined,
} as const satisfies Record<ResponseKind, MyPlanRole | undefined>;
/** Which part is shown when several are linked to one plan: the highest. */
const PRECEDENCE: readonly MyPlanRole[] = ["interested", "requested", "joined", "host"];
const rank = (role: MyPlanRole) => PRECEDENCE.indexOf(role);

const NONE: MyPlans = { upcoming: [], recent: [] };

/** The device's plans, with its account's when logged in; nothing without a known device. */
export async function listMyPlans(
  deps: Pick<PlanDeps, "plans" | "devices" | "tokens" | "clock" | "ids">,
  request: { deviceToken: string | undefined },
): Promise<MyPlans> {
  const device = await lookupDevice(deps, request.deviceToken);
  if (device === undefined) return NONE;
  const now = deps.clock.now().getTime();
  const linked = await deps.plans.findLinkedToDevice(device.id, "device_and_account");

  // A plan both hosted and answered counts once, as host; of several responses, the furthest.
  const byPlan = new Map<string, MyPlanItem>();
  for (const entry of linked) {
    const { plan } = entry;
    if (plan.status !== "active") continue;
    const role = entry.role === "host" ? "host" : ROLE_OF[entry.responseKind];
    if (role === undefined) continue;
    const before = byPlan.get(plan.id);
    if (before !== undefined && rank(before.role) >= rank(role)) continue;
    byPlan.set(plan.id, {
      planId: plan.id,
      title: plan.title,
      startsAt: plan.startsAt,
      timeZone: plan.timeZone,
      role,
    });
  }

  const items = [...byPlan.values()];
  const start = (item: MyPlanItem) => item.startsAt.getTime();
  const order = (a: MyPlanItem, b: MyPlanItem) => a.planId.localeCompare(b.planId);
  return {
    upcoming: items
      .filter((item) => start(item) >= now)
      .sort((a, b) => start(a) - start(b) || order(a, b))
      .slice(0, MAX_COMING_UP),
    recent: items
      .filter((item) => start(item) < now && start(item) >= now - RECENT_DAYS * DAY_MS)
      .sort((a, b) => start(b) - start(a) || order(a, b))
      .slice(0, MAX_RECENT),
  };
}
