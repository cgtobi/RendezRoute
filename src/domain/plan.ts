import type { PlanDraft } from "./plan-input.ts";

// Plan-level enumerations (spec section 4). Changing a list requires a migration.
export const VISIBILITIES = ["link", "followers", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const JOIN_MODES = ["open", "approval"] as const;
export type JoinMode = (typeof JOIN_MODES)[number];

export const PLAN_STATUSES = ["active", "cancelled"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const DROP_POLICIES = ["no_drop", "drop"] as const;
export type DropPolicy = (typeof DROP_POLICIES)[number];

/** A stored plan: the validated draft plus identity, lifecycle and later-version settings. */
export interface Plan extends PlanDraft {
  id: string;
  /** BCP 47 tag for the poster's notifications (spec 4). */
  posterLanguage: string;
  visibility: Visibility;
  joinMode: JoinMode;
  status: PlanStatus;
  createdAt: Date;
  updatedAt: Date;
}
