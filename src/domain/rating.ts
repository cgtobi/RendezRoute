// Plan ratings (spec 6a, decision D20): participants rate the plan, never the host, while the
// recap is open; only the host sees the result, after the close and from 3 participants.
import { hasRecap, isRecapOpen, recapClosesAt, type RecapState } from "./recap.ts";
import type { ResponseKind } from "./response.ts";
import { err, ok, type FieldError, type Result } from "./result.ts";
import { cleanText } from "./text.ts";

export const RATING_VALUES = ["up", "down"] as const;
export type RatingValue = (typeof RATING_VALUES)[number];

/** Decision D20. */
export const RATING_LIMITS = {
  /** Characters of the note to the host. */
  note: 500,
  /** Participants a plan needs before the host sees its result. */
  participantsForResult: 3,
} as const;

/** One participant's rating; one per response. */
export interface PlanRating {
  id: string;
  planId: string;
  responseId: string;
  value: RatingValue;
  /** To the host, signed with the participant's name. */
  note: string | undefined;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Recap timing plus when ratings were frozen: set when a host reopens a closed recap, so the
 * result never changes after it was first due (decision D20).
 */
export type RatedPlan = RecapState & { ratingsClosedAt: Date | undefined };

/** Participants rate, change and remove their rating while the recap is open, until frozen. */
export function canRate(
  plan: RatedPlan,
  kind: ResponseKind,
  now: Date,
): Result<true, "not_participant" | "rating_closed"> {
  if (kind !== "joined") return err("not_participant");
  return isRecapOpen(plan, now) && plan.ratingsClosedAt === undefined
    ? ok(true)
    : err("rating_closed");
}

export type RatingError = FieldError<"value" | "note">;

export function validateRating(input: {
  value: string;
  note: string;
}):
  | { ok: true; value: { value: RatingValue; note: string | undefined } }
  | { ok: false; errors: RatingError[] } {
  const errors: RatingError[] = [];
  const value = (RATING_VALUES as readonly string[]).includes(input.value)
    ? (input.value as RatingValue)
    : undefined;
  if (value === undefined) errors.push({ field: "value", code: "choice_invalid" });
  const note = cleanText(input.note, { max: RATING_LIMITS.note, multiline: true });
  if (!note.ok) errors.push({ field: "note", code: note.error });
  return errors.length > 0 || value === undefined || !note.ok
    ? { ok: false, errors }
    : { ok: true, value: { value, note: note.value } };
}

/**
 * The host sees the result once the recap has closed, so a change in the tally cannot be matched
 * to a person, and only for plans with at least 3 participants (decision D20).
 */
export function ratingResultVisible(plan: RatedPlan, participants: number, now: Date): boolean {
  return (
    hasRecap(plan, now) &&
    (plan.ratingsClosedAt !== undefined || !isRecapOpen(plan, now)) &&
    participants >= RATING_LIMITS.participantsForResult
  );
}

/**
 * When a change to the recap window is saved: a recap that had already closed freezes the ratings
 * at that close, even if the change reopens the recap for comments (decision D20).
 */
export function ratingsClosedAtAfter(plan: RatedPlan, now: Date): Date | undefined {
  if (plan.ratingsClosedAt !== undefined || !hasRecap(plan, now)) return plan.ratingsClosedAt;
  return isRecapOpen(plan, now) ? undefined : recapClosesAt(plan);
}

export interface RatingResult {
  participants: number;
  rated: number;
  up: number;
  down: number;
}

/** Counts against the participants ("4 of 7 rated: 3 up, 1 down"), never a bare score. */
export function ratingResult(values: readonly RatingValue[], participants: number): RatingResult {
  return {
    participants,
    rated: values.length,
    up: values.filter((value) => value === "up").length,
    down: values.filter((value) => value === "down").length,
  };
}
