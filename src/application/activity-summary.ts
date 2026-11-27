// The hourly summary line (0.19.0 commit B, ADR 009): how much the instance took in during the
// last hour, as counts only, so an operator can see a flood without a dashboard. Nothing
// personal is read: no names, no titles, no addresses.
import type { PlanDeps } from "./plans.ts";
import type { ReportRepository, ResponseRepository } from "./ports.ts";

/** Requests turned away since the last summary (limits, caps, full disk); kept in memory only. */
export interface RefusalCounter {
  add(): void;
  /** The count so far; starts again from zero. */
  take(): number;
}

export function createRefusalCounter(): RefusalCounter {
  let count = 0;
  return {
    add: () => {
      count += 1;
    },
    take: () => {
      const taken = count;
      count = 0;
      return taken;
    },
  };
}

export interface ActivitySummary {
  newPlans: number;
  responses: number;
  reports: number;
  refusals: number;
}

const HOUR_MS = 3_600_000;

export async function summarizeLastHour(
  deps: Pick<PlanDeps, "plans" | "clock"> & {
    responses: Pick<ResponseRepository, "countCreatedSince">;
    reports: Pick<ReportRepository, "countCreatedSince">;
    refusals: RefusalCounter;
  },
): Promise<ActivitySummary> {
  const since = new Date(deps.clock.now().getTime() - HOUR_MS);
  const [plans, responses, reports] = await Promise.all([
    deps.plans.countCreatedSince({ hour: since, day: since }),
    deps.responses.countCreatedSince(since),
    deps.reports.countCreatedSince(since),
  ]);
  return {
    newPlans: plans.lastHour,
    responses,
    reports,
    refusals: deps.refusals.take(),
  };
}
