// An account's own data (spec 3.7 "Logged-in identity: everything linked to the identity", 3.10;
// plan v1.0 step 5b; decisions D25, I52): what it owns, its export, its deletion, and deletion after
// 12 months unused. Deleting removes everything the account owns, as "Delete my data" does for a
// browser, then the account; its devices are logged out and keep only their own data.
import { accountDeleteAt, accountExpiryCutoff } from "../domain/expiry.ts";
import type { Identity } from "../domain/identity.ts";
import type { ResponseKind } from "../domain/response.ts";
import type { PlanTemplate } from "../domain/template.ts";
import { type DeviceDeps, resolveDevice } from "./devices.ts";
import {
  type ExportData,
  type ExportedPlan,
  type ExportedTemplate,
  exportedPlan,
  exportedTemplate,
  itemOf,
  type MyDataItem,
  removeOwnData,
} from "./my-data.ts";
import type { PlanDeps } from "./plans.ts";
import type { Device, IdentityRepository } from "./ports.ts";

export type AccountDataDeps = PlanDeps & { identities: IdentityRepository };

/**
 * The logged-in device and its account, if any. Using it counts as using the account (spec 3.10):
 * the device's activity, and with it the account's, is updated at most once a day.
 */
export async function loggedInAccount(
  deps: DeviceDeps & { identities: IdentityRepository },
  deviceToken: string | undefined,
): Promise<{ device: Device; identity: Identity } | undefined> {
  const device = await resolveDevice(deps, deviceToken);
  const identity =
    device?.identityId === undefined
      ? undefined
      : await deps.identities.findById(device.identityId);
  return device === undefined || identity === undefined ? undefined : { device, identity };
}

export interface AccountData {
  hosted: MyDataItem[];
  responses: (MyDataItem & { responseKind: ResponseKind })[];
  templates: Pick<PlanTemplate, "id" | "title" | "expiresAt" | "timeZone">[];
  /** Since when an invite link lets the account create plans, if one does. */
  mayPostSince: Date | undefined;
  /** Deleted then, with everything it owns, unless used again (spec 3.10). */
  deleteAt: Date;
}

/** What the account owns, for the account page and its deletion page. */
export async function viewAccountData(
  deps: AccountDataDeps,
  request: { deviceToken: string | undefined },
): Promise<{ kind: "account"; data: AccountData } | { kind: "logged_out" }> {
  const account = await loggedInAccount(deps, request.deviceToken);
  if (account === undefined) return { kind: "logged_out" };
  const { identity } = account;
  const owned = await deps.plans.findOwnedBy(identity.id);
  return {
    kind: "account",
    data: {
      hosted: owned.flatMap((entry) => (entry.role === "host" ? [itemOf(entry.plan)] : [])),
      responses: owned.flatMap((entry) =>
        entry.role === "manage"
          ? [{ ...itemOf(entry.plan), responseKind: entry.responseKind }]
          : [],
      ),
      templates: (await deps.templates.listOwnedBy(identity.id)).map(
        ({ id, title, expiresAt, timeZone }) => ({ id, title, expiresAt, timeZone }),
      ),
      mayPostSince: await deps.permissions.accountMayPostSince(identity.id),
      deleteAt: accountDeleteAt(identity.lastActiveAt),
    },
  };
}

/**
 * The account's export (spec 3.7): its plans and templates as the account sees them, never as
 * the exporting browser does on its own (decision I52), and the account itself.
 */
export async function exportAccountData(
  deps: AccountDataDeps,
  request: { deviceToken: string | undefined },
): Promise<{ kind: "found"; data: ExportData } | { kind: "not_found" }> {
  const account = await loggedInAccount(deps, request.deviceToken);
  if (account === undefined) return { kind: "not_found" };
  const { identity } = account;
  const device = { id: account.device.id, token: request.deviceToken };
  const plans: ExportedPlan[] = [];
  const seen = new Set<string>();
  for (const entry of await deps.plans.findOwnedBy(identity.id)) {
    if (seen.has(entry.plan.id)) continue;
    seen.add(entry.plan.id);
    const plan = await exportedPlan(deps, entry.plan.id, device, "account");
    if (plan !== undefined) plans.push(plan);
  }
  const templates: ExportedTemplate[] = [];
  for (const template of await deps.templates.listOwnedBy(identity.id)) {
    templates.push(await exportedTemplate(deps, template));
  }
  return {
    kind: "found",
    data: {
      exportedAt: deps.clock.now(),
      plans,
      templates,
      calendarFeed: false,
      mayPostSince: await deps.permissions.accountMayPostSince(identity.id),
      account: {
        provider: identity.provider,
        subject: identity.subject,
        handle: identity.handle,
        displayName: identity.displayName,
        createdAt: identity.createdAt,
        lastActiveAt: identity.lastActiveAt,
      },
    },
  };
}

/**
 * Everything the account owns, then the account; its devices are logged out (decision D25). An
 * item another device creates for the account in the same moment loses its owner and keeps only
 * its secret link; retention removes it (I52).
 */
async function deleteIdentity(deps: AccountDataDeps, identity: Identity): Promise<void> {
  await removeOwnData(
    deps,
    await deps.plans.findOwnedBy(identity.id),
    await deps.templates.listOwnedBy(identity.id),
  );
  // Its permissions go with it; its devices' identity_id is set null.
  await deps.identities.delete(identity.id);
}

/** "Delete my account" (spec 3.7): immediate and for good. */
export async function deleteAccount(
  deps: AccountDataDeps,
  request: { deviceToken: string | undefined },
): Promise<{ kind: "deleted" } | { kind: "logged_out" }> {
  const account = await loggedInAccount(deps, request.deviceToken);
  if (account === undefined) return { kind: "logged_out" };
  await deleteIdentity(deps, account.identity);
  return { kind: "deleted" };
}

/**
 * Accounts unused for 12 months are deleted with everything they own (spec 3.10). Each is read
 * again first, so one used since the list was made stays. The warning 14 days before needs a
 * channel of the account's own; those come with email, ntfy and Telegram (0.8, decision I52).
 */
export async function expireAccounts(deps: AccountDataDeps): Promise<number> {
  const cutoff = accountExpiryCutoff(deps.clock.now());
  let deleted = 0;
  for (const listed of await deps.identities.listUnusedBefore(cutoff)) {
    const identity = await deps.identities.findById(listed.id);
    if (identity === undefined || identity.lastActiveAt.getTime() >= cutoff.getTime()) continue;
    await deleteIdentity(deps, identity);
    deleted++;
  }
  return deleted;
}
