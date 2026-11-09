// The instance admin (spec 7 Moderation, 3.6 Instance admin column): logging in, public plan
// fields only, and deleting any plan. Every use case checks the admin session through `AdminAuth`.
import { deletionNotices } from "./notify.ts";
import type { PlanViewForInstanceAdmin } from "./plan-views.ts";
import { type PlanDeps, viewPlan } from "./plans.ts";
import type { AdminAuth, Clock } from "./ports.ts";

/** How long an admin session lasts (spec 7 Moderation). */
export const ADMIN_SESSION_HOURS = 12;

export interface AdminDeps extends PlanDeps {
  adminAuth: AdminAuth;
}

type NotAdmin = { kind: "not_admin" };

/** Whether the session value belongs to a logged-in admin. */
export function isAdmin(
  deps: { adminAuth: AdminAuth; clock: Clock },
  request: { session: string | undefined },
): boolean {
  return (
    request.session !== undefined && deps.adminAuth.hasSession(request.session, deps.clock.now())
  );
}

/** Checks the token; on success, the new session. Callers rate limit the attempts. */
export function logInAsAdmin(
  deps: { adminAuth: AdminAuth; clock: Clock },
  request: { token: string },
): { kind: "logged_in"; session: { value: string; expiresAt: Date } } | { kind: "refused" } {
  if (!deps.adminAuth.checkToken(request.token)) return { kind: "refused" };
  return { kind: "logged_in", session: deps.adminAuth.startSession(deps.clock.now()) };
}

/** What the admin sees of a plan: a few public fields, never private ones (spec 3.6). */
export async function viewPlanAsAdmin(
  deps: AdminDeps,
  request: { planId: string; session: string | undefined },
): Promise<{ kind: "found"; view: PlanViewForInstanceAdmin } | { kind: "not_found" } | NotAdmin> {
  if (!isAdmin(deps, request)) return { kind: "not_admin" };
  // Without a device the read model is the public one; the admin's is a part of it.
  const result = await viewPlan(deps, { planId: request.planId, deviceToken: undefined });
  if (result.kind === "not_found") return result;
  const { view } = result;
  return {
    kind: "found",
    view: {
      id: view.id,
      title: view.title,
      activity: view.activity,
      posterName: view.posterName,
      startsAt: view.startsAt,
      timeZone: view.timeZone,
      areaLabel: view.area.label,
      status: view.status,
      deleteAt: view.deleteAt,
      counts: { participants: view.counts.participants, interested: view.counts.interested },
    },
  };
}

/**
 * Deletes a plan for everyone (spec 3.10): people still in an upcoming plan are told first, and no
 * template is ever kept from an instance-admin deletion.
 */
export async function deletePlanAsAdmin(
  deps: AdminDeps,
  request: { planId: string; session: string | undefined },
): Promise<{ kind: "deleted" } | { kind: "not_found" } | NotAdmin> {
  if (!isAdmin(deps, request)) return { kind: "not_admin" };
  const plan = await deps.plans.findById(request.planId);
  if (plan === undefined) return { kind: "not_found" };
  const sendNotices = await deletionNotices(deps, plan);
  await deps.plans.delete(plan.id);
  await sendNotices();
  return { kind: "deleted" };
}
