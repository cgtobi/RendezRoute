// Joining on approval (spec 3.1, 3.4, 3.5, 6 feature 1): requests with an optional note, accepted
// or rejected by the host until the start; rejections and removals can be undone.
import type { JoinMode, PlanStatus } from "./plan.ts";
import { canRespond } from "./responding.ts";
import type { PlanResponse, ResponseKind } from "./response.ts";
import { err, ok, type Result } from "./result.ts";
import { cleanText, type TextError } from "./text.ts";

/** What someone can choose for their own response. */
export type ResponseChoice = "interested" | "joined" | "requested";

type PlanTiming = { startsAt: Date; status: PlanStatus };

/**
 * The choices per join mode (spec 3.4). An accepted participant in approval mode keeps "joined"
 * instead of being offered to request again (decision I37).
 */
export function choicesFor(joinMode: JoinMode, current?: ResponseKind): readonly ResponseChoice[] {
  if (joinMode === "open") return ["interested", "joined"];
  return current === "joined" ? ["interested", "joined"] : ["interested", "requested"];
}

export function isResponseChoice(
  value: string,
  joinMode: JoinMode,
  current?: ResponseKind,
): value is ResponseChoice {
  return (choicesFor(joinMode, current) as readonly string[]).includes(value);
}

export const MAX_REQUEST_NOTE_LENGTH = 500;

export function validateRequestNote(
  note: string,
): Result<string | undefined, Exclude<TextError, "required">> {
  return cleanText(note, { max: MAX_REQUEST_NOTE_LENGTH, multiline: true });
}

type DecisionError = "not_pending" | "plan_started" | "plan_cancelled";

/** The host decides only before the start of an active plan (spec 3.1). */
function decide(
  response: PlanResponse,
  plan: PlanTiming,
  now: Date,
  decided: PlanResponse,
): Result<PlanResponse, DecisionError> {
  if (response.kind !== "requested") return err("not_pending");
  const open = canRespond(plan, now);
  // A decided request has no further use for its note (spec 3.6: notes are for the pending request).
  return open.ok ? ok({ ...decided, requestNote: undefined, updatedAt: now }) : open;
}

export function acceptRequest(
  response: PlanResponse,
  plan: PlanTiming,
  now: Date,
): Result<PlanResponse, DecisionError> {
  return decide(response, plan, now, { ...response, kind: "joined" });
}

/** A rejected person sees what interested people see and cannot request again (spec 3.5). */
export function rejectRequest(
  response: PlanResponse,
  plan: PlanTiming,
  now: Date,
): Result<PlanResponse, DecisionError> {
  return decide(response, plan, now, { ...response, kind: "rejected", previousKind: "requested" });
}

/** A request nobody decided before the start (or before cancelling) shows as "not answered" (spec 3.1). */
export function isNotAnswered(response: PlanResponse, plan: PlanTiming, now: Date): boolean {
  return response.kind === "requested" && !canRespond(plan, now).ok;
}

/**
 * Undo of a rejection or removal (spec 3.5, decision I37). Before the start: back to pending in
 * approval mode, back to the previous state in open mode, where a former request counts as
 * joining; interested people return to interested in either mode. After the start nobody is
 * accepted any more: the previous state returns, and a rejection becomes an unanswered request.
 */
export function undoRejectionOrRemoval(
  response: PlanResponse,
  plan: PlanTiming & { joinMode: JoinMode },
  now: Date,
): Result<PlanResponse, "not_rejected_or_removed"> {
  if (response.kind !== "rejected" && response.kind !== "removed") {
    return err("not_rejected_or_removed");
  }
  const before: ResponseKind = response.previousKind ?? "requested";
  const decidable = canRespond(plan, now).ok;
  const kind: ResponseKind =
    before === "interested"
      ? "interested"
      : !decidable
        ? before
        : plan.joinMode === "approval"
          ? "requested"
          : "joined";
  return ok({ ...response, kind, previousKind: undefined, updatedAt: now });
}

/** Switching from approval to open mode accepts the pending requests; rejected stay rejected (spec 3.4). */
export function requestsAcceptedBySwitch(
  from: JoinMode,
  to: JoinMode,
  responses: readonly PlanResponse[],
): PlanResponse[] {
  return from === "approval" && to === "open"
    ? responses.filter((response) => response.kind === "requested")
    : [];
}
