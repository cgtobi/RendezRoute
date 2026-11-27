// Reports from the fediverse as an application use case (spec 7 Moderation, decisions D22, D46;
// 0.9 step 12b): plain data in, a plain result out; the quota hook is asked only for a plan that
// could be reported, once, and a refusal stores nothing.
import { describe, expect, it } from "vite-plus/test";
import { reportFromFederation } from "../../src/application/federated-reports.ts";
import { createTestApp } from "../support/app.ts";
import { TestClient } from "../support/client.ts";
import { createPlanViaUi } from "../support/plans.ts";

const GONE = "AAAAAAAAAAAAAAAAAAAAAA";

async function setup() {
  const test = await createTestApp({
    env: { ADMIN_TOKEN: "admin-token-for-tests-0123456789abcdef" },
  });
  const { planId } = await createPlanViaUi(new TestClient(test.app), {});
  const asked: string[] = [];
  const request = (overrides: Partial<Parameters<typeof reportFromFederation>[1]> = {}) => ({
    objects: [{ kind: "plan" as const, planId }],
    reporterOrigin: "https://reporter.example",
    text: "Plain 4471",
    admit: (id: string) => {
      asked.push(id);
      return true;
    },
    ...overrides,
  });
  return { test, planId, asked, request };
}

describe("reportFromFederation", () => {
  it("stores one report with reason other and asks the quota once, for the plan", async () => {
    const { test, planId, asked, request } = await setup();
    expect(await reportFromFederation(test.planDeps, request())).toBe("reported");
    const [report, ...more] = await test.planDeps.reports.listOpenForPlan(planId);
    expect(more).toEqual([]);
    expect(report).toMatchObject({ reason: "other", details: "Plain 4471", attached: [] });
    expect(asked).toEqual([planId]);
  });

  it("asks nothing and stores nothing for objects that resolve to no plan we show", async () => {
    const { test, planId, asked, request } = await setup();
    const objects = [
      { kind: "plan" as const, planId: GONE },
      { kind: "note" as const, noteId: "00000000-0000-4000-8000-000000000000" },
    ];
    expect(await reportFromFederation(test.planDeps, request({ objects }))).toBe("ignored");
    expect(await reportFromFederation(test.planDeps, request({ objects: [] }))).toBe("ignored");
    expect(asked).toEqual([]);
    expect(await test.planDeps.reports.listOpenForPlan(planId)).toEqual([]);
  });

  it("is limited, storing nothing, when the quota says no", async () => {
    const { test, planId, request } = await setup();
    const result = await reportFromFederation(test.planDeps, request({ admit: () => false }));
    expect(result).toBe("limited");
    expect(await test.planDeps.reports.listOpenForPlan(planId)).toEqual([]);
  });

  it("makes the details of the text: bidi controls and control characters gone, cut at 1,000 characters, then cleaned", async () => {
    const { test, planId, request } = await setup();
    const texts = [
      "  Spaced\u202E 6150\u0007x  ",
      `${"é".repeat(998)}  ${"z".repeat(50)}`,
      "   \u202E  ",
    ];
    for (const text of texts) await reportFromFederation(test.planDeps, request({ text }));
    // Reports made at one instant have no order of their own.
    const details = (await test.planDeps.reports.listOpenForPlan(planId)).map(
      (r) => r.details ?? "-",
    );
    expect(details.toSorted()).toEqual(["-", "é".repeat(998), "Spaced 6150 x"].toSorted());
  });

  /** The deps with one of our contribution Notes, sent to a person with this actor address. */
  function withNote(
    test: Awaited<ReturnType<typeof setup>>["test"],
    note: { planId: string; contributionPlanId: string },
    actorId: string,
  ) {
    const now = new Date();
    return {
      ...test.planDeps,
      posterActors: {
        ...test.planDeps.posterActors,
        contributionNotes: {
          ...test.planDeps.posterActors?.contributionNotes,
          findByNoteId: () =>
            Promise.resolve({
              noteId: "n1",
              contributionId: "c1",
              responseId: "r1",
              planId: note.planId,
              localActor: "instance",
              sentAt: now,
              contentHash: "h",
            }),
        },
      },
      responses: {
        ...test.planDeps.responses,
        remoteOf: () => Promise.resolve({ actor: { id: actorId }, join: {} }),
      },
      recap: {
        ...test.planDeps.recap,
        findById: () =>
          Promise.resolve({
            id: "c1",
            planId: note.contributionPlanId,
            responseId: undefined,
            body: "Copied 8840",
            linkUrl: undefined,
            hiddenByHost: false,
            createdAt: now,
            updatedAt: now,
          }),
      },
    } as unknown as typeof test.planDeps;
  }

  it("does not match opaque origins: two non-web actor addresses are not the same server", async () => {
    const { test, planId, request } = await setup();
    const deps = withNote(test, { planId, contributionPlanId: planId }, "foo://x/users/ben");
    const objects = [{ kind: "note" as const, noteId: "n1" }];
    expect(await reportFromFederation(deps, request({ objects, reporterOrigin: "null" }))).toBe(
      "ignored",
    );
    expect(await test.planDeps.reports.listOpenForPlan(planId)).toEqual([]);
    // The same note from a real match is taken, so the fake is sound.
    const real = withNote(test, { planId, contributionPlanId: planId }, "https://a.example/ben");
    expect(
      await reportFromFederation(real, request({ objects, reporterOrigin: "https://a.example" })),
    ).toBe("reported");
  });

  it("attaches no copy of a contribution that belongs to another plan than its Note's row says", async () => {
    const { test, planId, request } = await setup();
    const deps = withNote(
      test,
      { planId, contributionPlanId: "BBBBBBBBBBBBBBBBBBBBBB" },
      "https://a.example/ben",
    );
    const objects = [{ kind: "note" as const, noteId: "n1" }];
    const result = await reportFromFederation(
      deps,
      request({ objects, reporterOrigin: "https://a.example" }),
    );
    expect(result).toBe("reported");
    const [report] = await test.planDeps.reports.listOpenForPlan(planId);
    expect(report?.attached).toEqual([]);
  });
});
