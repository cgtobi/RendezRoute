/** Response kinds (spec 3.5, section 4). Changing this list requires a migration. */
export const RESPONSE_KINDS = ["interested", "requested", "rejected", "joined", "removed"] as const;
export type ResponseKind = (typeof RESPONSE_KINDS)[number];
