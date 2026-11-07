/** Response kinds (spec 3.5, section 4). Changing this list requires a migration. */
export const RESPONSE_KINDS = ["interested", "requested", "rejected", "joined", "removed"] as const;
export type ResponseKind = (typeof RESPONSE_KINDS)[number];

/** A person's response to a plan (spec 3.5). */
export interface PlanResponse {
  id: string;
  planId: string;
  kind: ResponseKind;
  displayName: string;
  /** BCP 47 tag from the browser, for this person's notifications (spec 4). */
  language: string;
  /** Kind before removal, so the host can undo it (spec 3.5). */
  previousKind: ResponseKind | undefined;
  createdAt: Date;
  updatedAt: Date;
}
