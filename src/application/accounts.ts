// Accounts (spec 7 Identity, 3.11 Account takeover; plan v1.0 step 4a): logging in through an
// identity provider links the device to the account; there is no second cookie (plan v1.0, settled
// 4). A login is bound to the browser that started it (its state in a short-lived cookie), can be
// finished once and within ten minutes; the provider checks PKCE, nonce and the redirect.
import {
  displayNameFromProvider,
  type Identity,
  type IdentityProviderKind,
  loginCutoff,
  loginExpired,
  type DisplayNameError,
  validateDisplayName,
} from "../domain/identity.ts";
import {
  type FediverseServerError,
  fediverseServerAllowed,
  parseFediverseServer,
} from "../domain/fediverse.ts";
import { loggedInAccount } from "./account-data.ts";
import { ensureDevice, lookupDevice } from "./devices.ts";
import type { PlanDeps } from "./plans.ts";
import type {
  ChannelOwner,
  ClaimCounts,
  IdentityProvider,
  IdentityRepository,
  ProviderAccount,
  LinkedPlan,
  LookupHasher,
  PendingLoginRepository,
} from "./ports.ts";

export interface AccountDeps extends PlanDeps {
  identities: IdentityRepository;
  pendingLogins: PendingLoginRepository;
  /** Keyed hash of provider and subject, for finding an account (spec 4 identities). */
  identityLookup: LookupHasher;
  /** The configured ways to log in. */
  identityProviders: Partial<Record<IdentityProviderKind, IdentityProvider>>;
  /** Fediverse login's accepted servers (none listed: any) and whether local fakes may be used. */
  fediverse: { servers: readonly string[] | undefined; allowInsecure: boolean };
}

/**
 * Starts a login: the provider's URL to send the browser to, and the state the browser keeps in its
 * login cookie. A fediverse login names the server, as typed; it must be a public server and on the
 * list when FEDIVERSE_LOGIN_SERVERS has one. Logins left unfinished are dropped here.
 */
export async function startLogin(
  deps: AccountDeps,
  request: { provider: IdentityProviderKind; server?: string | undefined },
): Promise<
  | { kind: "redirect"; authorizationUrl: URL; state: string }
  | { kind: "invalid"; error: FediverseServerError }
  | { kind: "unavailable" }
  | { kind: "not_found" }
> {
  const provider = deps.identityProviders[request.provider];
  if (provider === undefined) return { kind: "not_found" };
  let server: string | undefined;
  if (request.provider === "fediverse") {
    const parsed = parseFediverseServer(request.server ?? "", {
      allowInsecure: deps.fediverse.allowInsecure,
    });
    if (!parsed.ok) return { kind: "invalid", error: parsed.error };
    if (!fediverseServerAllowed(parsed.value, deps.fediverse.servers)) {
      return { kind: "invalid", error: "server_not_allowed" };
    }
    server = parsed.value;
  }
  const now = deps.clock.now();
  await deps.pendingLogins.deleteStartedBefore(loginCutoff(now));
  let started: Awaited<ReturnType<IdentityProvider["startLogin"]>>;
  try {
    started = await provider.startLogin({ server });
  } catch {
    return { kind: "unavailable" };
  }
  const { authorizationUrl, secrets } = started;
  await deps.pendingLogins.create(deps.tokens.hash(secrets.state), {
    provider: request.provider,
    secrets,
    startedAt: now,
  });
  return { kind: "redirect", authorizationUrl, state: secrets.state };
}

/**
 * Finishes a login at the callback: only in the browser that started it (the state in its cookie
 * must match the callback's), once, within ten minutes, and only if the provider's checks pass.
 * The account is found by a keyed hash of provider and subject, or created.
 */
export async function finishLogin(
  deps: AccountDeps,
  request: {
    provider: IdentityProviderKind;
    callback: URL;
    /** The state from the browser's login cookie. */
    cookieState: string | undefined;
    deviceToken: string | undefined;
  },
): Promise<{ kind: "logged_in"; newDeviceToken: string } | { kind: "failed" }> {
  const failed = { kind: "failed" } as const;
  const provider = deps.identityProviders[request.provider];
  const callbackState = request.callback.searchParams.get("state");
  if (provider === undefined || request.cookieState === undefined || callbackState === null) {
    return failed;
  }
  // Compared as hashes, so the comparison takes the same time whatever matches.
  const stateHash = deps.tokens.hash(request.cookieState);
  if (deps.tokens.hash(callbackState) !== stateHash) return failed;
  const pending = await deps.pendingLogins.take(stateHash);
  const now = deps.clock.now();
  if (
    pending === undefined ||
    pending.provider !== request.provider ||
    loginExpired(pending.startedAt, now)
  ) {
    return failed;
  }
  const result = await provider.finishLogin(request.callback, pending.secrets);
  if (!result.ok) return failed;

  const identity = await findOrCreateIdentity(deps, request.provider, result.account, now);
  const { device, newToken } = await ensureDevice(deps, request.deviceToken);
  // Another account on a device still logged in: the first account's push subscriptions go, as
  // when logging out.
  if (device.identityId !== undefined && device.identityId !== identity.id) {
    await removeAccountOnlyChannels(deps, device.id);
  }
  await deps.devices.setIdentity(device.id, identity.id);
  // Logging in gives the device cookie more power: a new token, so an older or planted one stops
  // working (session fixation). The device keeps its links.
  if (newToken !== undefined) return { kind: "logged_in", newDeviceToken: newToken };
  const renewed = deps.tokens.generate();
  await deps.devices.replaceToken(device.id, deps.tokens.hash(renewed));
  return { kind: "logged_in", newDeviceToken: renewed };
}

/** The account with this provider's subject, found by its keyed hash, or a new one. */
async function findOrCreateIdentity(
  deps: AccountDeps,
  provider: IdentityProviderKind,
  account: ProviderAccount,
  now: Date,
): Promise<Identity> {
  const subjectHash = deps.identityLookup.hash(`${provider}:${account.subject}`);
  const existing = await deps.identities.findBySubjectHash(provider, subjectHash);
  if (existing !== undefined) return seenAgain(deps, existing, account, now);
  const identity: Identity = {
    id: deps.ids.rowId(),
    provider,
    subject: account.subject,
    handle: account.handle,
    displayName: displayNameFromProvider(account.names),
    createdAt: now,
    lastActiveAt: now,
  };
  try {
    await deps.identities.create(identity, subjectHash);
    return identity;
  } catch (error) {
    // The same person's first login finished a moment earlier in another browser.
    const winner = await deps.identities.findBySubjectHash(provider, subjectHash);
    if (winner === undefined) throw error;
    return seenAgain(deps, winner, account, now);
  }
}

/** An account logging in again: active now, and a renamed fediverse account's new handle. */
async function seenAgain(
  deps: AccountDeps,
  identity: Identity,
  account: ProviderAccount,
  now: Date,
): Promise<Identity> {
  await deps.identities.touch(identity.id, now);
  if (identity.handle !== account.handle)
    await deps.identities.setHandle(identity.id, account.handle);
  return { ...identity, handle: account.handle, lastActiveAt: now };
}

/** The account logged in on this device; using it counts as using the account (spec 3.10). */
const accountOf = loggedInAccount;

export type AccountView =
  | { kind: "logged_out" }
  | {
      kind: "account";
      provider: IdentityProviderKind;
      displayName: string | undefined;
      /** What this browser holds that is not in the account yet (claiming, step 5a). */
      claimable: ClaimCounts;
    };

/** What the account page shows: never the subject (spec 7 Identity). */
export async function viewAccount(
  deps: AccountDeps,
  request: { deviceToken: string | undefined },
): Promise<AccountView> {
  const account = await accountOf(deps, request.deviceToken);
  return account === undefined
    ? { kind: "logged_out" }
    : {
        kind: "account",
        provider: account.identity.provider,
        displayName: account.identity.displayName,
        claimable: await deps.devices.claimable(account.device.id),
      };
}

/**
 * Claiming (spec 7 Identity, user decision 2026-11-10): moves this browser's own plans, responses
 * and templates that no account owns into the account logged in on it, so they reach every device
 * logged in to it. Only on request; other devices' links and other accounts' items stay.
 */
export async function claimDeviceData(
  deps: AccountDeps,
  request: { deviceToken: string | undefined },
): Promise<{ kind: "claimed"; moved: ClaimCounts } | { kind: "logged_out" }> {
  const account = await accountOf(deps, request.deviceToken);
  if (account === undefined) return { kind: "logged_out" };
  const moved = await deps.devices.claimInto(account.device.id, account.identity.id);
  return { kind: "claimed", moved };
}

export async function renameAccount(
  deps: AccountDeps,
  request: { deviceToken: string | undefined; displayName: string },
): Promise<
  { kind: "renamed" } | { kind: "invalid"; error: DisplayNameError } | { kind: "logged_out" }
> {
  const account = await accountOf(deps, request.deviceToken);
  if (account === undefined) return { kind: "logged_out" };
  const name = validateDisplayName(request.displayName);
  if (!name.ok) return { kind: "invalid", error: name.error };
  await deps.identities.setDisplayName(account.identity.id, name.value);
  return { kind: "renamed" };
}

/**
 * Logs this device out; the account and everything else on the device stay. The browser's push
 * subscriptions for what it reached only through the account go, so a borrowed browser stops
 * receiving them (step 5a).
 */
export async function logOut(
  deps: AccountDeps,
  request: { deviceToken: string | undefined },
): Promise<{ kind: "logged_out" }> {
  const device = await lookupDevice(deps, request.deviceToken);
  if (device?.identityId === undefined) return { kind: "logged_out" };
  await removeAccountOnlyChannels(deps, device.id);
  await deps.devices.setIdentity(device.id, undefined);
  return { kind: "logged_out" };
}

/** Removes the device's channels for items it reaches only through its account. */
async function removeAccountOnlyChannels(deps: AccountDeps, deviceId: string): Promise<void> {
  if (deps.notify === undefined) return;
  const own = new Set((await deps.plans.findLinkedToDevice(deviceId, "device")).map(ownerKey));
  const throughAccount = (
    await deps.plans.findLinkedToDevice(deviceId, "device_and_account")
  ).filter((entry) => !own.has(ownerKey(entry)));
  await deps.notify.channels.removeForDevice(deviceId, throughAccount.map(channelOwnerOf));
}

const channelOwnerOf = (entry: LinkedPlan): ChannelOwner =>
  entry.role === "host" ? { planId: entry.plan.id } : { responseId: entry.responseId };

const ownerKey = (entry: LinkedPlan) =>
  entry.role === "host" ? `plan:${entry.plan.id}` : `response:${entry.responseId}`;
