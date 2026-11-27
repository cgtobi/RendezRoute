// The instance admin (spec 7 Moderation, 3.6 Instance admin column): logging in, open reports,
// public plan fields with the plan's reports, resolving reports and deleting any plan. Every use
// case checks the admin session through `AdminAuth`.
import { withdrawDeletedPlans } from "./publishing.ts";
import {
  type AttachedContribution,
  copyOfPost,
  type Report,
  type ReportReason,
} from "../domain/report.ts";
import { deletionNotices } from "./notify.ts";
import type { PlanViewForInstanceAdmin } from "./plan-views.ts";
import { type PlanDeps, viewPlan } from "./plans.ts";
import type { AdminAuth, Clock, RecentPlanRow } from "./ports.ts";

/** How long an admin session lasts (spec 7 Moderation). */
export const ADMIN_SESSION_HOURS = 12;

export interface AdminDeps extends PlanDeps {
  adminAuth: AdminAuth;
}

type NotAdmin = { kind: "not_admin" };

/** An open report as listed on the admin's home: what it is about, not what it says. */
export interface OpenReportSummary {
  planId: string;
  planTitle: string;
  reason: ReportReason;
}

/** A report as the admin reads it: only what the reporter wrote and chose to attach (spec 3.6). */
export interface ReportView {
  id: string;
  reason: ReportReason;
  details: string | undefined;
  attached: AttachedContribution[];
  createdAt: Date;
}

const reportView = (report: Report): ReportView => ({
  id: report.id,
  reason: report.reason,
  details: report.details,
  attached: report.attached.map(copyOfPost),
  createdAt: report.createdAt,
});

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

/** The admin's home: open reports, oldest first, with their plan's title. */
export async function adminOverview(
  deps: AdminDeps,
  request: { session: string | undefined },
): Promise<{ kind: "overview"; openReports: OpenReportSummary[] } | NotAdmin> {
  if (!isAdmin(deps, request)) return { kind: "not_admin" };
  const openReports = (await deps.reports.listOpen()).map((row): OpenReportSummary => ({
    planId: row.planId,
    planTitle: row.planTitle,
    reason: row.reason,
  }));
  return { kind: "overview", openReports };
}

/**
 * What the admin sees of a plan: a few public fields, never private ones, and its open reports
 * with the content their reporters attached (spec 3.6).
 */
export async function viewPlanAsAdmin(
  deps: AdminDeps,
  request: { planId: string; session: string | undefined },
): Promise<
  | {
      kind: "found";
      view: PlanViewForInstanceAdmin;
      reports: { open: ReportView[]; resolved: number };
    }
  | { kind: "not_found" }
  | NotAdmin
> {
  if (!isAdmin(deps, request)) return { kind: "not_admin" };
  // Without a device the read model is the public one; the admin's is a part of it.
  const result = await viewPlan(deps, { planId: request.planId, deviceToken: undefined });
  if (result.kind === "not_found") return result;
  const { view } = result;
  return {
    kind: "found",
    reports: {
      open: (await deps.reports.listOpenForPlan(view.id)).map(reportView),
      resolved: await deps.reports.countResolvedForPlan(view.id),
    },
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
  const result = await deletePlanAsOperator(deps, request.planId);
  return result.kind === "deleted" ? { kind: "deleted" } : result;
}

/**
 * The deletion behind `deletePlanAsAdmin`, for the operator's command line, which has no session
 * (whoever runs it has the data directory): the same notices, federation `Delete` and physical
 * removal. The notices and the `Delete` are queued as jobs; the running server sends them.
 */
export async function deletePlanAsOperator(
  deps: PlanDeps,
  planId: string,
): Promise<{ kind: "deleted"; title: string } | { kind: "not_found" }> {
  const plan = await deps.plans.findById(planId);
  if (plan === undefined) return { kind: "not_found" };
  const sendNotices = await deletionNotices(deps, plan);
  await withdrawDeletedPlans(deps, [plan]);
  await deps.plans.delete(plan.id);
  await sendNotices();
  return { kind: "deleted", title: plan.title };
}

/** The newest plans with their public title and response count, for the command line. */
export async function listRecentPlans(
  deps: Pick<PlanDeps, "plans">,
  { limit }: { limit: number },
): Promise<RecentPlanRow[]> {
  return deps.plans.listRecent(limit);
}

/**
 * Marks a report resolved; it leaves the open list and stays until its plan is deleted. Resolving
 * it again is no error: the admin may have clicked twice.
 */
export async function resolveReport(
  deps: AdminDeps,
  request: { reportId: string; session: string | undefined },
): Promise<
  | { kind: "resolved"; planId: string }
  | { kind: "already_resolved"; planId: string }
  | { kind: "not_found" }
  | NotAdmin
> {
  if (!isAdmin(deps, request)) return { kind: "not_admin" };
  const result = await deps.reports.resolve(request.reportId, deps.clock.now());
  if (result === undefined) return { kind: "not_found" };
  return { kind: result.wasOpen ? "resolved" : "already_resolved", planId: result.planId };
}
