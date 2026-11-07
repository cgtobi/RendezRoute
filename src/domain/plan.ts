// Plan-level enumerations (spec section 4). Changing a list requires a migration.
export const VISIBILITIES = ["link", "followers", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const JOIN_MODES = ["open", "approval"] as const;
export type JoinMode = (typeof JOIN_MODES)[number];

export const PLAN_STATUSES = ["active", "cancelled"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const DROP_POLICIES = ["no_drop", "drop"] as const;
export type DropPolicy = (typeof DROP_POLICIES)[number];
