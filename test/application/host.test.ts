import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  cancelPlan,
  deletePlan,
  editPlan,
  removePerson,
  restorePerson,
  viewHostPage,
} from "../../src/application/host.ts";
import { createPlan, type PlanDeps, viewPlan } from "../../src/application/plans.ts";
import { respond } from "../../src/application/responses.ts";
import { planToInput } from "../../src/domain/plan-edit.ts";
import { FakeClock } from "../fakes/clock.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

let deps: PlanDeps;
let repos: ReturnType<typeof createFakeRepositories>;
let clock: FakeClock;
let planId: string;
let host: string | undefined;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;

beforeEach(async () => {
  repos = createFakeRepositories();
  clock = new FakeClock(fixtureNow);
  deps = {
    ...repos,
    routeParser: new FakeRouteParser(),
    tokens: new FakeTokenService(),
    ids: new SequentialIdGenerator(),
    clock,
    limits: { horizonDays: 180, maxRetentionDays: 30 },
    postingMode: "anyone",
  };
  const created = await createPlan(deps, {
    input: sampleInput,
    units: "metric",
    language: "en",
    creationNonce: nonce(),
    deviceToken: undefined,
  });
  if (created.kind !== "created") throw new Error("setup failed");
  planId = created.planId;
  host = created.newDeviceToken;
});

async function person(name: string, choice: "joined" | "interested") {
  const result = await respond(deps, {
    planId,
    choice,
    displayName: name,
    language: "en",
    creationNonce: nonce(),
    deviceToken: undefined,
  });
  if (result.kind !== "created") throw new Error(`respond failed: ${result.kind}`);
  const response = await repos.responses.findByManageTokenHash(
    deps.tokens.hash(result.manageToken),
  );
  if (response === undefined) throw new Error("missing response");
  return { ...result, responseId: response.id };
}

async function currentInput() {
  const plan = await repos.plans.findById(planId);
  if (plan === undefined) throw new Error("missing plan");
  return planToInput(plan, "metric");
}

describe("host access (spec 5 feature 7)", () => {
  it("is limited to devices linked as host", async () => {
    const ben = await person("Ben", "joined");
    for (const deviceToken of [undefined, ben.newDeviceToken]) {
      expect(await viewHostPage(deps, { planId, deviceToken, units: "metric" })).toEqual({
        kind: "forbidden",
      });
      expect(await cancelPlan(deps, { planId, deviceToken })).toEqual({ kind: "forbidden" });
      expect(await deletePlan(deps, { planId, deviceToken })).toEqual({ kind: "forbidden" });
    }
    expect(
      await viewHostPage(deps, { planId: "nope", deviceToken: host, units: "metric" }),
    ).toEqual({
      kind: "not_found",
    });
  });

  it("shows the form values and people with their response IDs", async () => {
    const ben = await person("Ben", "joined");
    const cleo = await person("Cleo", "interested");
    await removePerson(deps, { planId, deviceToken: host, responseId: cleo.responseId });
    const page = await viewHostPage(deps, { planId, deviceToken: host, units: "metric" });
    expect(page).toMatchObject({
      kind: "found",
      scope: "all",
      canCancel: true,
      input: { title: "Easy Sunday run", exactDescription: "North gate, by the bike racks" },
      people: {
        participants: [{ responseId: ben.responseId, name: "Ben" }],
        interested: [],
        removed: [{ responseId: cleo.responseId, name: "Cleo" }],
      },
    });
  });
});

describe("editPlan (spec 3.1 Editing)", () => {
  it("updates every field before the start and recomputes delete_at", async () => {
    const input = {
      ...(await currentInput()),
      title: "Longer Sunday run",
      date: "2026-06-14",
      retentionDays: "7",
    };
    expect(
      await editPlan(deps, {
        planId,
        deviceToken: host,
        input,
        units: "metric",
        confirmDeleteNow: false,
      }),
    ).toEqual({ kind: "updated" });
    const plan = await repos.plans.findById(planId);
    expect(plan).toMatchObject({
      title: "Longer Sunday run",
      retentionDays: 7,
      deleteAt: new Date("2026-06-21T05:30:00Z"),
      updatedAt: fixtureNow,
    });
  });

  it("returns field errors without saving", async () => {
    const input = { ...(await currentInput()), title: "" };
    expect(
      await editPlan(deps, {
        planId,
        deviceToken: host,
        input,
        units: "metric",
        confirmDeleteNow: false,
      }),
    ).toEqual({
      kind: "invalid",
      errors: [{ field: "title", code: "required" }],
    });
  });

  it("does not let the host take a responder's name (decision D8)", async () => {
    await person("Ben", "joined");
    const input = { ...(await currentInput()), posterName: "ben" };
    expect(
      await editPlan(deps, {
        planId,
        deviceToken: host,
        input,
        units: "metric",
        confirmDeleteNow: false,
      }),
    ).toEqual({
      kind: "invalid",
      errors: [{ field: "posterName", code: "name_taken_by_response" }],
    });
  });

  it("allows only retention after the start, ignoring other fields", async () => {
    clock.set("2026-06-07T08:00:00Z");
    const input = { ...(await currentInput()), title: "Sneaky", retentionDays: "3" };
    expect(
      await editPlan(deps, {
        planId,
        deviceToken: host,
        input,
        units: "metric",
        confirmDeleteNow: false,
      }),
    ).toEqual({ kind: "updated", recapWindowShortened: "1d" });
    expect(await repos.plans.findById(planId)).toMatchObject({
      title: "Easy Sunday run",
      retentionDays: 3,
      recapWindow: "1d",
    });
  });

  it("asks before a retention edit that deletes the plan now, and deletes on confirmation (spec 3.1)", async () => {
    clock.set("2026-06-09T00:00:00Z");
    const input = { ...(await currentInput()), retentionDays: "1" };
    expect(
      await editPlan(deps, {
        planId,
        deviceToken: host,
        input,
        units: "metric",
        confirmDeleteNow: false,
      }),
    ).toEqual({
      kind: "confirm_delete_now",
    });
    expect(await repos.plans.findById(planId)).toBeDefined();
    expect(
      await editPlan(deps, {
        planId,
        deviceToken: host,
        input,
        units: "metric",
        confirmDeleteNow: true,
      }),
    ).toEqual({ kind: "deleted" });
    expect(await repos.plans.findById(planId)).toBeUndefined();
  });
});

describe("cancelPlan (spec 5 feature 8, decision D8)", () => {
  it("cancels before the start, finally", async () => {
    expect(await cancelPlan(deps, { planId, deviceToken: host })).toEqual({ kind: "cancelled" });
    expect(await repos.plans.findById(planId)).toMatchObject({ status: "cancelled" });
    expect(await cancelPlan(deps, { planId, deviceToken: host })).toEqual({
      kind: "not_allowed",
      reason: "already_cancelled",
    });
    expect(await viewHostPage(deps, { planId, deviceToken: host, units: "metric" })).toMatchObject({
      scope: "retention",
      canCancel: false,
    });
  });

  it("is not possible after the start", async () => {
    clock.set("2026-06-07T06:00:00Z");
    expect(await cancelPlan(deps, { planId, deviceToken: host })).toEqual({
      kind: "not_allowed",
      reason: "plan_started",
    });
  });
});

describe("deletePlan (spec 5 feature 9)", () => {
  it("hard-deletes the plan with its responses", async () => {
    const ben = await person("Ben", "joined");
    expect(await deletePlan(deps, { planId, deviceToken: host })).toEqual({ kind: "deleted" });
    expect(await repos.plans.findById(planId)).toBeUndefined();
    expect(await repos.responses.findById(ben.responseId)).toBeUndefined();
    expect(await viewPlan(deps, { planId, deviceToken: host })).toEqual({ kind: "not_found" });
  });
});

describe("removing people (spec 3.5)", () => {
  it("removes a participant, who then loses private details, and restores them on undo", async () => {
    const ben = await person("Ben", "joined");
    expect(
      await removePerson(deps, { planId, deviceToken: host, responseId: ben.responseId }),
    ).toEqual({ kind: "removed" });
    expect((await viewPlan(deps, { planId, deviceToken: ben.newDeviceToken })).kind).toBe(
      "responder",
    );
    expect(
      await restorePerson(deps, { planId, deviceToken: host, responseId: ben.responseId }),
    ).toEqual({ kind: "restored" });
    expect((await viewPlan(deps, { planId, deviceToken: ben.newDeviceToken })).kind).toBe(
      "participant",
    );
  });

  it("only touches responses of this plan, and only for the host", async () => {
    const ben = await person("Ben", "joined");
    expect(
      await removePerson(deps, {
        planId,
        deviceToken: ben.newDeviceToken,
        responseId: ben.responseId,
      }),
    ).toEqual({ kind: "forbidden" });
    expect(await removePerson(deps, { planId, deviceToken: host, responseId: "other" })).toEqual({
      kind: "not_found",
    });
    expect(
      await restorePerson(deps, { planId, deviceToken: host, responseId: ben.responseId }),
    ).toEqual({ kind: "not_allowed" });
  });
});
