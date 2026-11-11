// Poster actors' handles (spec 7 ActivityPub; decisions D36, D37): the name part of
// @name@host, chosen once when the fediverse profile is created and fixed afterwards.
import { err, ok, type Result } from "./result.ts";

/** A handle's characters, also for the route of its profile page (/@handle). */
export const HANDLE_PATTERN = "[a-z0-9_]{1,30}";
const HANDLE = new RegExp(`^${HANDLE_PATTERN}$`);
/** Names that would pass for the instance or its staff. */
const RESERVED = new Set([
  "admin",
  "administrator",
  "instance",
  "moderator",
  "rendezroute",
  "root",
  "staff",
  "support",
  "system",
  "www",
]);

export type HandleError = "handle_invalid" | "handle_reserved";

export function validateHandle(input: string): Result<string, HandleError> {
  const handle = input.trim().toLowerCase();
  if (!HANDLE.test(handle)) return err("handle_invalid");
  return RESERVED.has(handle) ? err("handle_reserved") : ok(handle);
}

/** A starting point from the display name; empty when nothing usable is left. */
export function suggestHandle(displayName: string): string {
  const handle = displayName
    .normalize("NFD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30)
    .replace(/_+$/, "");
  return validateHandle(handle).ok ? handle : "";
}

/** How the fediverse writes an actor's address: @handle@host. */
export const fediverseAddress = (handle: string, host: string): string => `@${handle}@${host}`;
