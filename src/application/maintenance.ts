// Automatic retention and housekeeping (spec 3.10), run by the scheduler and the CLI.
import {
  backupExpiryCutoff,
  capRetention,
  deviceExpiryCutoffs,
  usedFormNonceCutoff,
} from "../domain/expiry.ts";
import type { PlanDeps } from "./plans.ts";
import type { BackupStore, PendingLoginRepository } from "./ports.ts";
import { loginCutoff } from "../domain/identity.ts";
import { deletePlansKeepingTemplates } from "./templates.ts";
import type { Plan } from "../domain/plan.ts";

/** Hard-deletes every plan whose delete_at has passed, cancelled ones included. No notifications (spec 3.10). */
export async function runRetentionSweep(deps: PlanDeps): Promise<{ deletedPlans: number }> {
  const due = await deps.plans.findDueForDeletion(deps.clock.now());
  // Plans that opted in leave a template (spec 3.10).
  await deletePlansKeepingTemplates(deps, due);
  return { deletedPlans: due.length };
}

/**
 * Daily expiry of templates, devices, unfinished logins and pre-migration backups (spec 3.10,
 * 11).
 */
export async function runHousekeeping(
  deps: PlanDeps & {
    backups: BackupStore;
    pendingLogins: PendingLoginRepository;
  },
): Promise<{
  deletedTemplates: number;
  deletedDevices: number;
  deletedFeeds: number;
  deletedBackups: number;
  deletedFormNonces: number;
  deletedPendingLogins: number;
}> {
  const now = deps.clock.now();
  // Templates first, so devices linked only to them count as unlinked right away.
  const deletedTemplates = await deps.templates.deleteExpired(now);
  const deletedDevices = await deps.devices.deleteInactive(deviceExpiryCutoffs(now));
  // Feeds that no longer reference anything (spec 3.10); those of deleted devices went with them.
  const deletedFeeds = await deps.calendarFeeds.deleteUnlinked();
  const deletedBackups = await deps.backups.deleteOlderThan(backupExpiryCutoff(now));
  const deletedFormNonces = await deps.formNonces.deleteUsedBefore(usedFormNonceCutoff(now));
  const deletedPendingLogins = await deps.pendingLogins.deleteStartedBefore(loginCutoff(now));
  return {
    deletedTemplates,
    deletedDevices,
    deletedFeeds,
    deletedBackups,
    deletedFormNonces,
    deletedPendingLogins,
  };
}

/** Applies a lowered MAX_RETENTION_DAYS to existing plans (CLI `apply-retention-max`, spec 3.10). */
export async function applyRetentionMax(
  deps: PlanDeps,
  { maxRetentionDays }: { maxRetentionDays: number },
): Promise<{ shortened: number; deleted: number }> {
  const now = deps.clock.now();
  const toDelete: Plan[] = [];
  let shortened = 0;
  for (const plan of await deps.plans.findWithRetentionAbove(maxRetentionDays)) {
    const capped = capRetention(plan, maxRetentionDays, now);
    if (capped.kind === "delete") {
      toDelete.push(plan);
    } else if (capped.kind === "shortened") {
      const { retentionDays, recapWindow, deleteAt } = capped;
      await deps.plans.update({ ...plan, retentionDays, recapWindow, deleteAt, updatedAt: now });
      shortened++;
    }
  }
  // Same path as retention deletion.
  await deletePlansKeepingTemplates(deps, toDelete);
  return { shortened, deleted: toDelete.length };
}
