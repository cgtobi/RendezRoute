// Who counts for a plan's rating result (spec 6a, decision D20): joined people who can rate, so
// not those who joined from another server (they have no web device), and the instance's
// minimum number of them before the host sees the result.
import { RATING_LIMITS } from "../domain/rating.ts";
import type { PlanDeps } from "./plans.ts";

export interface RatingRules {
  /** Response ids of people who joined from the fediverse; they cannot rate. */
  remoteIds: ReadonlySet<string>;
  /** RATING_MIN_PARTICIPANTS. */
  minimum: number;
}

export async function ratingRulesFor(deps: PlanDeps, planId: string): Promise<RatingRules> {
  return {
    remoteIds: new Set(await deps.responses.listRemoteIds(planId)),
    minimum: deps.ratingMinParticipants ?? RATING_LIMITS.participantsForResult,
  };
}
