// Who may respond, and with which name (spec 3.1 Responding, 3.5).
import type { PlanStatus } from "./plan.ts";
import type { ResponseKind } from "./response.ts";
import { err, ok, type Result } from "./result.ts";
import { cleanText, type TextError } from "./text.ts";

/** Choices in open join mode (spec 3.4): "Interested" and "I'm in". Approval mode arrives in v0.5. */
export const OPEN_MODE_CHOICES = [
  "interested",
  "joined",
] as const satisfies readonly ResponseKind[];
export type OpenModeChoice = (typeof OPEN_MODE_CHOICES)[number];

/** Same limit as the poster name (decision D7). */
export const MAX_DISPLAY_NAME_LENGTH = 50;

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

export function validateDisplayName(
  name: string,
  posterName: string,
): Result<string, TextError | "name_taken_by_host"> {
  const cleaned = cleanText(name, { max: MAX_DISPLAY_NAME_LENGTH });
  if (!cleaned.ok) return cleaned;
  if (cleaned.value === undefined) return err("required");
  if (isPosterName(cleaned.value, posterName)) return err("name_taken_by_host");
  return ok(cleaned.value);
}

/**
 * Switching between interested and joined follows the rules for new responses; removed
 * and rejected people stay out (spec 3.5).
 */
export function canChangeResponse(
  response: { kind: ResponseKind },
  plan: { startsAt: Date; status: PlanStatus },
  now: Date,
): Result<true, "plan_started" | "plan_cancelled" | "blocked"> {
  if (response.kind === "removed" || response.kind === "rejected") return err("blocked");
  return canRespond(plan, now);
}
