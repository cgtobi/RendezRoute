// What the instance as a whole accepts (0.19.0 commit A): new plans up to a daily and an hourly
// cap, and, while the disk is nearly full, no new plans and no route files. Everything else
// (managing, joining, deleting, exports) is never blocked from here.
import { judgeNewPlans, newPlanCaps, type StorageLevel } from "../domain/instance-limits.ts";
import type { PlanDeps } from "./plans.ts";

/**
 * Plans being created right now: past the cap check but not yet stored. The app is one Node
 * process, so counting them next to the stored plans keeps parallel creates from all passing a
 * check made before any of them inserted.
 */
export interface NewPlanSlots {
  inFlight: number;
  /** Checks run one after the other, so each sees the slots the one before took. */
  gate: Promise<void>;
}

export interface InstanceLimits {
  /** MAX_NEW_PLANS_PER_DAY: 0 to 200; 0 pauses new plans. */
  maxNewPlansPerDay: number;
  /** The cached disk level (see storage-guard.ts); never reads the disk. */
  storage: () => StorageLevel;
  slots: NewPlanSlots;
}

export function createInstanceLimits(
  limits: Pick<InstanceLimits, "maxNewPlansPerDay" | "storage">,
): InstanceLimits {
  return { ...limits, slots: { inFlight: 0, gate: Promise.resolve() } };
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const STORAGE_RETRY_SECONDS = 3600;

export type NewPlanSlot =
  | { ok: true; release: () => void }
  | { ok: false; retryAfterSeconds: number };

const NO_LIMITS: NewPlanSlot = { ok: true, release: () => undefined };

/**
 * Takes a place for one new plan, or says why the instance takes none now: the disk is nearly
 * full, or the plans created in the last hour or day (counted from the stored plans) plus those
 * being created right now reach the caps. `release` must run once the plan was stored or the
 * attempt failed, whichever comes first, so a failed create gives its place back.
 */
export async function reserveNewPlan(
  deps: Pick<PlanDeps, "plans" | "clock" | "instanceLimits">,
): Promise<NewPlanSlot> {
  const limits = deps.instanceLimits;
  if (limits === undefined) return NO_LIMITS;
  if (limits.storage() === "critical") {
    return { ok: false, retryAfterSeconds: STORAGE_RETRY_SECONDS };
  }
  const { slots } = limits;
  const caps = newPlanCaps(limits.maxNewPlansPerDay);
  const decide = async (): Promise<NewPlanSlot> => {
    const now = deps.clock.now().getTime();
    const stored = await deps.plans.countCreatedSince({
      hour: new Date(now - HOUR_MS),
      day: new Date(now - DAY_MS),
    });
    // A create that has stored its plan but not yet released its slot is counted twice (stored
    // and in flight) for a moment: that errs on the safe side, refusing a create too early
    // rather than exceeding the cap.
    const verdict = judgeNewPlans(caps, {
      lastHour: stored.lastHour + slots.inFlight,
      lastDay: stored.lastDay + slots.inFlight,
    });
    if (!verdict.allowed) return { ok: false, retryAfterSeconds: verdict.retryAfterSeconds };
    slots.inFlight += 1;
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        slots.inFlight -= 1;
      },
    };
  };
  const decision = slots.gate.then(decide);
  slots.gate = decision.then(
    () => undefined,
    () => undefined,
  );
  return decision;
}

/** Whether route (GPX) uploads are refused: the disk is nearly full. */
export function routeUploadsRefused(deps: Pick<PlanDeps, "instanceLimits">): boolean {
  return deps.instanceLimits?.storage() === "critical";
}
