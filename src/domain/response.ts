/** Response kinds (spec 3.5, section 4). Changing this list requires a migration. */
export const RESPONSE_KINDS = ["interested", "requested", "rejected", "joined", "removed"] as const;
export type ResponseKind = (typeof RESPONSE_KINDS)[number];

/** Rejected and removed people: blocked from responding again, told nothing more (spec 3.5). */
export function isBlocked(kind: ResponseKind): boolean {
  return kind === "rejected" || kind === "removed";
}

/** A person's response to a plan (spec 3.5). */
export interface PlanResponse {
  id: string;
  planId: string;
  kind: ResponseKind;
  displayName: string;
  /** BCP 47 tag from the browser, for this person's notifications (spec 4). */
  language: string;
  /** Kind before removal or rejection, so the host can undo it (spec 3.5). */
  previousKind: ResponseKind | undefined;
  /** Optional note with a request to join (spec 6 feature 1); only the host sees it. */
  requestNote?: string | undefined;
  createdAt: Date;
  updatedAt: Date;
}
