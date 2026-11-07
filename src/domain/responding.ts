// Who may respond, and with which name (spec 3.1 Responding, 3.5).
import type { PlanStatus } from "./plan.ts";
import { err, ok, type Result } from "./result.ts";

/** No new responses or requests from the start time on, in any join mode, nor for cancelled plans (decision D6). */
export function canRespond(
  plan: { startsAt: Date; status: PlanStatus },
  now: Date,
): Result<true, "plan_started" | "plan_cancelled"> {
  if (plan.status === "cancelled") return err("plan_cancelled");
  if (now.getTime() >= plan.startsAt.getTime()) return err("plan_started");
  return ok(true);
}

/** Unicode-normalized, whitespace runs collapsed, case-folded. */
const comparable = (name: string) =>
  name.normalize("NFC").replace(/\s+/gu, " ").trim().toLowerCase();

/** Responses may not use exactly the poster's display name (case-insensitive), so the host badge stays unambiguous. */
export function isPosterName(name: string, posterName: string): boolean {
  return comparable(name) === comparable(posterName);
}
