import type { PlanDraft } from "./plan-input.ts";
import type { RatingResult } from "./rating.ts";

// Plan-level enumerations (spec section 4). Changing a list requires a migration.
export const VISIBILITIES = ["link", "followers", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];
/** What the forms offer; whether followers or public may be chosen is the use case's (D35, D37). */
export const CHOOSABLE_VISIBILITIES = [
  "link",
  "followers",
  "public",
] as const satisfies readonly Visibility[];

/**
 * Whether a plan may be public (spec 7 Visibility and Nearby plans): with PUBLIC_REQUIRES_LOGIN
 * only when it belongs to an account. A plan already public stays so, like a retention above a
 * lowered maximum (spec 3.10).
 */
export function mayBePublic(
  rule: { requiresLogin: boolean },
  plan: { ownerIdentityId: string | undefined; visibility?: Visibility | undefined },
): boolean {
  return !rule.requiresLogin || plan.ownerIdentityId !== undefined || plan.visibility === "public";
}

export const JOIN_MODES = ["open", "approval"] as const;
export type JoinMode = (typeof JOIN_MODES)[number];

export const PLAN_STATUSES = ["active", "cancelled"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/**
 * The share buttons a host can offer on the plan page (spec 5 feature 4, decisions D30, D41):
 * copy link, the device's share sheet and a WhatsApp link, in that order.
 */
export const SHARE_BUTTONS = ["copy", "native", "whatsApp"] as const;
export type ShareButton = (typeof SHARE_BUTTONS)[number];

export const DROP_POLICIES = ["no_drop", "drop"] as const;
export type DropPolicy = (typeof DROP_POLICIES)[number];

/** A stored plan: the validated draft plus identity, lifecycle and later-version settings. */
export interface Plan extends PlanDraft {
  id: string;
  /** BCP 47 tag for the poster's notifications (spec 4). */
  posterLanguage: string;
  joinMode: JoinMode;
  status: PlanStatus;
  /** The route itself is loaded separately, only where it may be shown (spec 3.6). */
  hasRoute: boolean;
  /** Set when the recap window was changed after the start (spec 6 feature 6). */
  recapWindowSetAt: Date | undefined;
  /** Set when the host closed the recap after the start. */
  recapClosedAt: Date | undefined;
  /**
   * When the plan was saved as followers or public under the fediverse wording, by an owner with a
   * profile (decisions D35, D37); only such plans are shared in the fediverse (step 10).
   */
  federatedAt: Date | undefined;
  /** Set when a host reopens a closed recap: ratings stay closed from then on (spec 6a). */
  ratingsClosedAt: Date | undefined;
  /** The rating counts, stored before anything changes them after the close (spec 6a). */
  ratingTally: RatingResult | undefined;
  createdAt: Date;
  updatedAt: Date;
}
