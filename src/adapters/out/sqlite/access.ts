// Which rows of the device_access view a scope reads (steps 5a, 5b): the device's own links
// ('link'), its account's items ('account'), or both.
import type { AccessScope } from "../../../application/ports.ts";

const SOURCES = {
  device: "link",
  account: "account",
  device_and_account: undefined,
} as const satisfies Record<AccessScope, "link" | "account" | undefined>;

/** The view's source to keep, or undefined for both. */
export const accessSource = (scope: AccessScope) => SOURCES[scope];
