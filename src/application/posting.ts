// Invite links (spec 7 Moderation; plan v1.0 step 3). With POSTING_MODE=invite only devices that
// opened a valid invite link may create plans (posting-rules.ts). Invite links are secret links:
// opening one changes nothing, only confirming it (POST) lets the device post (decision D1).
import {
  type Invite,
  type InviteError,
  type InviteState,
  type InviteInput,
  inviteState,
  validateInviteInput,
} from "../domain/invite.ts";
import { type AdminDeps, isAdmin } from "./admin.ts";
import { ensureDevice } from "./devices.ts";
import { CREATION_NONCE, type PlanDeps } from "./plans.ts";
import { deviceMayPost } from "./posting-rules.ts";

type NotAdmin = { kind: "not_admin" };

/** The invite behind a token, if it can still be used now. */
async function usableInvite(deps: PlanDeps, token: string, now: Date) {
  const invite = await deps.invites.findByTokenHash(deps.tokens.hash(token));
  return invite !== undefined && inviteState(invite, now) === "usable" ? invite : undefined;
}

/** Unknown, used up, expired and revoked invites look the same to whoever opens them. */
export type OpenInviteResult =
  | { kind: "invalid" }
  | { kind: "already_allowed" }
  | { kind: "confirm" };

/**
 * Opening an invite link: never changes state, not even device activity (decision D1). A link that
 * cannot be used answers the same to every device, one that may already post included.
 */
export async function openInvite(
  deps: PlanDeps,
  request: { token: string; deviceToken: string | undefined },
): Promise<OpenInviteResult> {
  if ((await usableInvite(deps, request.token, deps.clock.now())) === undefined) {
    return { kind: "invalid" };
  }
  return (await deviceMayPost(deps, request.deviceToken))
    ? { kind: "already_allowed" }
    : { kind: "confirm" };
}

/**
 * Confirming an invite link (POST): the device may post from now on. A device that already may
 * uses nothing up; no device is kept for an invite that is not usable.
 */
export async function confirmInvite(
  deps: PlanDeps,
  request: { token: string; deviceToken: string | undefined },
): Promise<{ kind: "invalid" } | { kind: "allowed"; newDeviceToken: string | undefined }> {
  const now = deps.clock.now();
  const invite = await usableInvite(deps, request.token, now);
  if (invite === undefined) return { kind: "invalid" };
  if (await deviceMayPost(deps, request.deviceToken)) {
    return { kind: "allowed", newDeviceToken: undefined };
  }
  const { device, newToken } = await ensureDevice(deps, request.deviceToken);
  const redeemed = await deps.invites.redeem({
    inviteId: invite.id,
    deviceId: device.id,
    permissionId: deps.ids.rowId(),
    now,
  });
  if (redeemed === "unusable") {
    // Used up by another device a moment ago: a device made just for this goes again (decision P2).
    if (newToken !== undefined) await deps.devices.delete(device.id);
    return { kind: "invalid" };
  }
  return { kind: "allowed", newDeviceToken: newToken };
}

/** An invite as the admin's list shows it. */
export type InviteView = Invite & { state: InviteState };

export async function listInvites(
  deps: AdminDeps,
  request: { session: string | undefined },
): Promise<{ kind: "invites"; invites: InviteView[] } | NotAdmin> {
  if (!isAdmin(deps, request)) return { kind: "not_admin" };
  const now = deps.clock.now();
  const invites = (await deps.invites.list()).map((invite): InviteView => ({
    ...invite,
    state: inviteState(invite, now),
  }));
  return { kind: "invites", invites };
}

/**
 * A new invite link with optional last day and usage limit. The link exists only in this result:
 * only its hash is stored (spec 3.2). A form sent again creates nothing (decision I44).
 */
export async function createInvite(
  deps: AdminDeps,
  request: InviteInput & {
    session: string | undefined;
    /** The instance's time zone, in which the last day ends. */
    timeZone: string;
    nonce: string;
  },
): Promise<
  | { kind: "created"; token: string; invite: Invite }
  | { kind: "invalid"; errors: InviteError[] }
  | { kind: "duplicate" }
  | { kind: "bad_request" }
  | NotAdmin
> {
  if (!isAdmin(deps, request)) return { kind: "not_admin" };
  if (!CREATION_NONCE.test(request.nonce)) return { kind: "bad_request" };
  const now = deps.clock.now();
  const input = validateInviteInput(request, { now, timeZone: request.timeZone });
  if (!input.ok) return { kind: "invalid", errors: input.errors };
  if (!(await deps.formNonces.claim(request.nonce, now))) return { kind: "duplicate" };
  const token = deps.tokens.generate();
  const invite: Invite = {
    id: deps.ids.rowId(),
    ...input.value,
    uses: 0,
    revokedAt: undefined,
    createdAt: now,
  };
  await deps.invites.create(invite, deps.tokens.hash(token));
  return { kind: "created", token, invite };
}

/** Revoking stops the link from working; devices that used it may still post. */
export async function revokeInvite(
  deps: AdminDeps,
  request: { session: string | undefined; inviteId: string },
): Promise<{ kind: "revoked" } | { kind: "not_found" } | NotAdmin> {
  if (!isAdmin(deps, request)) return { kind: "not_admin" };
  const found = await deps.invites.revoke(request.inviteId, deps.clock.now());
  return found ? { kind: "revoked" } : { kind: "not_found" };
}
