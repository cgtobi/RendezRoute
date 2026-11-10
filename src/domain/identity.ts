// Accounts (spec 7 Identity): someone logged in through an identity provider. The device they log
// in on is linked to the account; no second cookie (plan v1.0, settled 4). Only an encrypted
// identifier and the display name are kept, never passwords or tokens.
import { err, ok, type Result } from "./result.ts";
import { cleanText } from "./text.ts";

export const IDENTITY_PROVIDERS = ["oidc", "fediverse"] as const;
export type IdentityProviderKind = (typeof IDENTITY_PROVIDERS)[number];

export interface Identity {
  id: string;
  provider: IdentityProviderKind;
  /** The provider's stable identifier for the account (issuer or server included); encrypted. */
  subject: string;
  /** A fediverse account's handle, @name@host, updated at each login; encrypted (D23). */
  handle: string | undefined;
  displayName: string | undefined;
  createdAt: Date;
  lastActiveAt: Date;
}

export const IDENTITY_LIMITS = {
  /** As the poster's name (spec 5 feature 1). */
  displayName: 50,
} as const;

export type DisplayNameError = "too_long" | "invalid_characters";

export function validateDisplayName(value: string): Result<string | undefined, DisplayNameError> {
  const cleaned = cleanText(value, { max: IDENTITY_LIMITS.displayName });
  return cleaned.ok ? ok(cleaned.value) : err(cleaned.error);
}

/** The first of the provider's names that is a valid display name, if any. */
export function displayNameFromProvider(
  candidates: readonly (string | undefined)[],
): string | undefined {
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const valid = validateDisplayName(candidate);
    if (valid.ok && valid.value !== undefined) return valid.value;
  }
  return undefined;
}

/** A login started must be finished within this time; then its one-time values are gone. */
export const LOGIN_WINDOW_MINUTES = 10;

export function loginExpired(startedAt: Date, now: Date): boolean {
  return startedAt.getTime() <= loginCutoff(now).getTime();
}

/** Logins started at or before this time can no longer be finished. */
export function loginCutoff(now: Date): Date {
  return new Date(now.getTime() - LOGIN_WINDOW_MINUTES * 60_000);
}
