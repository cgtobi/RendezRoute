// Reporting a plan to the instance admin (spec 7 Moderation, decisions D22, I47). Anyone who can open the
// plan may report it; the reporter may attach recap posts they can see, which are copied without
// their authors' names. Nothing records who sent a report.
import {
  type AttachedContribution,
  copyOfPost,
  type ReportError,
  validateReport,
} from "../domain/report.ts";
import { queueReportAlert } from "./email.ts";
import { CREATION_NONCE, type PlanDeps, viewPlan } from "./plans.ts";

type Request = { planId: string; deviceToken: string | undefined };

/** A recap post the reporter could attach, as they see it on the plan page. */
export type AttachablePost = AttachedContribution & { id: string };

/** The recap posts this device sees on the plan page (spec 3.6), oldest first. */
async function visiblePosts(
  deps: PlanDeps,
  request: Request,
): Promise<{ title: string; posts: AttachablePost[] } | undefined> {
  const result = await viewPlan(deps, request);
  if (result.kind === "not_found") return undefined;
  const recap =
    result.kind === "participant" || result.kind === "poster" ? result.view.recap : undefined;
  return {
    title: result.view.title,
    posts: (recap?.contributions ?? []).map((post) => ({ id: post.id, ...copyOfPost(post) })),
  };
}

export async function reportForm(
  deps: PlanDeps,
  request: Request,
): Promise<
  { kind: "form"; planTitle: string; attachable: AttachablePost[] } | { kind: "not_found" }
> {
  const visible = await visiblePosts(deps, request);
  if (visible === undefined) return { kind: "not_found" };
  return { kind: "form", planTitle: visible.title, attachable: visible.posts };
}

/**
 * Stores the report. `created` is false when the same form was sent again (decision I44), so the
 * caller can give back the rate-limit token.
 */
export async function reportPlan(
  deps: PlanDeps,
  request: Request & { reason: string; details: string; attach: readonly string[]; nonce: string },
): Promise<
  | { kind: "sent"; created: boolean }
  | { kind: "invalid"; errors: ReportError[] }
  | { kind: "bad_request" }
  | { kind: "not_found" }
> {
  const visible = await visiblePosts(deps, request);
  if (visible === undefined) return { kind: "not_found" };
  if (!CREATION_NONCE.test(request.nonce)) return { kind: "bad_request" };
  const checked = validateReport(request);
  if (!checked.ok) return { kind: "invalid", errors: checked.errors };
  const now = deps.clock.now();
  if (!(await deps.formNonces.claim(request.nonce, now))) return { kind: "sent", created: false };
  const chosen = new Set(request.attach);
  await deps.reports.create({
    id: deps.ids.rowId(),
    planId: request.planId,
    ...checked.value,
    // Only posts the reporter can see, in page order, without who wrote them.
    attached: visible.posts.filter((post) => chosen.has(post.id)).map(copyOfPost),
    createdAt: now,
    resolvedAt: undefined,
  });
  await queueReportAlert(deps, request.planId);
  return { kind: "sent", created: true };
}
