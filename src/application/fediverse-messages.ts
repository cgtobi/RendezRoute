// Fediverse direct messages (spec 7 Optional notification channels, decisions D44, D45, D47): for
// an account with a fediverse login, the account notices (today the expiry warning) come as direct
// messages from the instance actor. One channel per account, stored confirmed (the login proved
// the account) and with nothing about the recipient: the login's handle is looked up each time
// a message is sent. Switching it on looks the handle up once and, only if it resolves, stores the
// choice and queues one short first message. The recipient is always the account's own login,
// never anything a request carries. Only available while federation is on.
import type { Identity } from "../domain/identity.ts";
import { accountOf, queueConfirmation } from "./channel-links.ts";
import type { PlanDeps } from "./plans.ts";
import type { IdentityRepository } from "./ports.ts";

type Unavailable = { kind: "unavailable" };
const UNAVAILABLE: Unavailable = { kind: "unavailable" };

type Deps = PlanDeps & { identities: Pick<IdentityRepository, "findById"> };

export type FediverseMessagesSetting = {
  kind: "setting";
  state: "off" | "on";
  /** On, but federation is off: nothing is sent, and only turning off is left. */
  paused?: true;
};

/** The account, if it has a fediverse login (federation on or not): the only one with a switch. */
async function fediverseAccount(
  deps: Deps,
  deviceToken: string | undefined,
): Promise<{ owner: { identityId: string }; identity: Identity } | undefined> {
  const owner = await accountOf(deps, deviceToken);
  const identity =
    owner === undefined ? undefined : await deps.identities.findById(owner.identityId);
  return owner === undefined ||
    identity === undefined ||
    identity.provider !== "fediverse" ||
    identity.handle === undefined
    ? undefined
    : { owner, identity };
}

/** The account that may switch it on: with a fediverse login, and federation on. */
async function eligibleAccount(deps: Deps, deviceToken: string | undefined) {
  return deps.notify?.fediverseMessages === undefined
    ? undefined
    : fediverseAccount(deps, deviceToken);
}

/**
 * What the account page shows. Nothing for an account without a fediverse login, or while
 * federation is off, except for a channel that is on, which can only be turned off then
 * (`paused`: nothing is sent while federation is off).
 */
export async function fediverseMessagesSetting(
  deps: Deps,
  request: { deviceToken: string | undefined },
): Promise<FediverseMessagesSetting | Unavailable> {
  const account = await fediverseAccount(deps, request.deviceToken);
  if (account === undefined) return UNAVAILABLE;
  const channel = await deps.notify?.channels.fediverseDmFor(account.owner);
  if (deps.notify?.fediverseMessages === undefined) {
    return channel === undefined ? UNAVAILABLE : { kind: "setting", state: "on", paused: true };
  }
  return { kind: "setting", state: channel === undefined ? "off" : "on" };
}

export type TurnOnResult =
  | { kind: "on" }
  | { kind: "unchanged" }
  /** The login's address could not be found now: nothing was stored. */
  | { kind: "unresolved" }
  | Unavailable;

/**
 * Switches the channel on: looks the account's own handle up first and stores nothing unless it
 * resolves; then stores the choice and queues the first message. Already on: nothing changes and
 * nothing is sent. The language is the page's, which later notices use.
 */
export async function turnOnFediverseMessages(
  deps: Deps,
  request: { deviceToken: string | undefined; language: string },
): Promise<TurnOnResult> {
  const account = await eligibleAccount(deps, request.deviceToken);
  const messages = deps.notify?.fediverseMessages;
  if (account === undefined || messages === undefined || deps.notify === undefined) {
    return UNAVAILABLE;
  }
  if ((await deps.notify.channels.fediverseDmFor(account.owner)) !== undefined) {
    return { kind: "unchanged" };
  }
  const found = await messages.lookup.resolve(account.identity.handle ?? "");
  if (found.kind !== "found") return { kind: "unresolved" };
  const { id, created } = await deps.notify.channels.setFediverseDm(
    account.owner,
    request.language,
  );
  // Another request stored it between the check and now: the lookup was made, so it counts.
  if (!created) return { kind: "on" };
  await queueConfirmation(deps, account.owner, id);
  return { kind: "on" };
}

/** Switches it off, whether or not federation is on; no message is sent. */
export async function turnOffFediverseMessages(
  deps: PlanDeps,
  request: { deviceToken: string | undefined },
): Promise<{ kind: "off" } | Unavailable> {
  const owner = await accountOf(deps, request.deviceToken);
  if (owner === undefined) return UNAVAILABLE;
  const channel = await deps.notify?.channels.fediverseDmFor(owner);
  if (channel !== undefined) await deps.notify?.channels.delete(channel.id);
  return { kind: "off" };
}

/** What a queued account notice or delivery carries to find it again when the account goes. */
const isForAccount = (identityId: string) => (payload: unknown) =>
  typeof payload === "object" &&
  payload !== null &&
  (payload as Record<string, unknown>).forAccount === identityId;

const mentionsChannel = (channelId: string) => (payload: unknown) =>
  typeof payload === "object" &&
  payload !== null &&
  (payload as Record<string, unknown>).channelId === channelId;

/**
 * Removes what is queued for an account's direct messages once the account is gone: the messages
 * not yet delivered, which carry the recipient's actor and inbox, and the jobs that would have
 * made them. Run after the account is deleted, so nothing queued in between slips through (what
 * a job already running queues is also dropped at delivery, which checks the account and its
 * channel). The delivery queue is only searched for a fediverse login, the only kind with such
 * messages. Other jobs are left alone.
 */
export async function removeAccountMessageJobs(
  deps: Pick<PlanDeps, "notify">,
  account: { identityId: string; provider: Identity["provider"]; channelId: string | undefined },
): Promise<void> {
  const jobs = deps.notify?.jobs;
  if (jobs === undefined) return;
  if (account.provider === "fediverse") {
    await jobs.deleteWhere("federationDelivery", isForAccount(account.identityId));
  }
  if (account.channelId === undefined) return;
  await jobs.deleteWhere("channelConfirmation", mentionsChannel(account.channelId));
  await jobs.deleteWhere("accountNotice", mentionsChannel(account.channelId));
}
