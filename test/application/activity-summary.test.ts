import { describe, expect, it } from "vite-plus/test";
import { createRefusalCounter, summarizeLastHour } from "../../src/application/activity-summary.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { fixtureNow, samplePlan } from "../fixtures/plans.ts";

describe("summarizeLastHour (ADR 009)", () => {
  it("counts the last hour's plans, responses, reports and the refusals since the last summary", async () => {
    const repos = createFakeRepositories();
    const minutesAgo = (n: number) => new Date(fixtureNow.getTime() - n * 60_000);
    for (const [id, ago] of [
      ["a", 10],
      ["b", 59],
      ["c", 61],
    ] as const) {
      await repos.plans.create({
        plan: samplePlan({ id, createdAt: minutesAgo(ago), updatedAt: minutesAgo(ago) }),
        hostTokenHash: `h-${id}`,
        creationNonce: `n-${id}`,
        hostDeviceId: "d",
        ownerIdentityId: undefined,
      });
    }
    const refusals = createRefusalCounter();
    refusals.add();
    refusals.add();
    const deps = {
      plans: repos.plans,
      responses: repos.responses,
      reports: repos.reports,
      clock: { now: () => fixtureNow },
      refusals,
    };
    expect(await summarizeLastHour(deps)).toEqual({
      newPlans: 2,
      responses: 0,
      reports: 0,
      refusals: 2,
    });
    // The counter starts again after each summary.
    expect((await summarizeLastHour(deps)).refusals).toBe(0);
  });
});
