// Automatic retention and housekeeping (spec 3.10), run by the scheduler and the CLI.
import { capRetention, deviceExpiryCutoffs } from "../domain/expiry.ts";
import type { PlanDeps } from "./plans.ts";

/** Hard-deletes every plan whose delete_at has passed, cancelled ones included. No notifications (spec 3.10). */
export async function runRetentionSweep(deps: PlanDeps): Promise<{ deletedPlans: number }> {
  const due = await deps.plans.findDueForDeletion(deps.clock.now());
  // Templates (v0.5) will be created here before deletion, for plans that opted in.
  await deps.plans.deleteMany(due);
  return { deletedPlans: due.length };
}

/** Daily expiry of devices; templates, caches and backups join in later steps (spec 3.10). */
export async function runHousekeeping(deps: PlanDeps): Promise<{ deletedDevices: number }> {
  const deletedDevices = await deps.devices.deleteInactive(deviceExpiryCutoffs(deps.clock.now()));
  return { deletedDevices };
}

/** Applies a lowered MAX_RETENTION_DAYS to existing plans (CLI `apply-retention-max`, spec 3.10). */
export async function applyRetentionMax(
  deps: PlanDeps,
  { maxRetentionDays }: { maxRetentionDays: number },
): Promise<{ shortened: number; deleted: number }> {
  const now = deps.clock.now();
  const toDelete: string[] = [];
  let shortened = 0;
  for (const plan of await deps.plans.findWithRetentionAbove(maxRetentionDays)) {
    const capped = capRetention(plan, maxRetentionDays, now);
    if (capped.kind === "delete") {
      toDelete.push(plan.id);
    } else if (capped.kind === "shortened") {
      const { retentionDays, recapWindow, deleteAt } = capped;
      await deps.plans.update({ ...plan, retentionDays, recapWindow, deleteAt, updatedAt: now });
      shortened++;
    }
  }
  // Same path as retention deletion.
  await deps.plans.deleteMany(toDelete);
  return { shortened, deleted: toDelete.length };
}
