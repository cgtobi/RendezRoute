// The home page's own plans: what the device hosts and answered, as titles and starts only.
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  acceptRequest,
  cancelPlan,
  rejectRequest,
  removePerson,
} from "../../src/application/host.ts";
import { listMyPlans, MAX_COMING_UP, MAX_RECENT } from "../../src/application/my-plans.ts";
import type { Plan } from "../../src/domain/plan.ts";
import { createPlan, type PlanDeps } from "../../src/application/plans.ts";
import { respond } from "../../src/application/responses.ts";
import { FakeClock } from "../fakes/clock.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

// "Now" is 1 June 2026 08:00 UTC.
let deps: PlanDeps;
let repos: ReturnType<typeof createFakeRepositories>;
let clock: FakeClock;
let n = 0;
const dayOf = (day: number) => new Date(Date.UTC(2026, 5, day)).toISOString().slice(0, 10);
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;

beforeEach(() => {
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
});

async function newPlan(title: string, date = "2026-06-07", deviceToken?: string) {
  const created = await createPlan(deps, {
    input: { ...sampleInput, title, date, joinMode: "approval" },
    units: "metric",
    language: "en",
    creationNonce: nonce(),
    deviceToken,
  });
  if (created.kind !== "created") throw new Error("setup failed");
  return { planId: created.planId, host: created.newDeviceToken ?? deviceToken };
}

async function respondTo(planId: string, choice: string, deviceToken?: string) {
  const result = await respond(deps, {
    planId,
    choice,
    displayName: "Benedikta Quill",
    requestNote: "",
    language: "en",
    creationNonce: nonce(),
    deviceToken,
  });
  if (result.kind !== "created") throw new Error(`respond failed: ${result.kind}`);
  const response = await repos.responses.findByManageTokenHash(
    deps.tokens.hash(result.manageToken),
  );
  return { responseId: response?.id ?? "", device: result.newDeviceToken ?? deviceToken };
}

async function planOf(planId: string) {
  const plan = await repos.plans.findById(planId);
  if (plan === undefined) throw new Error("no plan");
  return plan;
}

async function manageEntry(
  planId: string,
  responseKind: "interested" | "requested" | "joined" | "rejected" | "removed",
) {
  return {
    plan: await planOf(planId),
    role: "manage" as const,
    responseId: `r-${responseKind}`,
    responseKind,
  };
}

type Entry = Awaited<ReturnType<typeof manageEntry>> | { plan: Plan; role: "host" };

/** The same dependencies, but with the given links, in the given order. */
const linked = (entries: Entry[]) => ({
  ...deps,
  plans: { ...repos.plans, findLinkedToDevice: () => Promise.resolve(entries) },
});

const mine = (deviceToken: string | undefined) => listMyPlans(deps, { deviceToken });
const titles = (items: readonly { title: string }[]) => items.map((item) => item.title);

describe("listing my plans", () => {
  it("lists hosted plans and answered ones with their role, never another device's", async () => {
    const hosted = await newPlan("Hosted", "2026-06-05");
    const other = await newPlan("Interested", "2026-06-04");
    const asked = await newPlan("Asked", "2026-06-06");
    const joined = await newPlan("Joined", "2026-06-08");
    await newPlan("Someone else's", "2026-06-09");
    await respondTo(other.planId, "interested", hosted.host);
    await respondTo(asked.planId, "requested", hosted.host);
    const joining = await respondTo(joined.planId, "requested", hosted.host);
    await acceptRequest(deps, {
      planId: joined.planId,
      deviceToken: joined.host,
      responseId: joining.responseId,
    });
    const { upcoming, recent } = await mine(hosted.host);
    expect(recent).toEqual([]);
    expect(upcoming.map((item) => [item.title, item.role])).toEqual([
      ["Interested", "interested"],
      ["Hosted", "host"],
      ["Asked", "requested"],
      ["Joined", "joined"],
    ]);
    // A stranger's device sees none of it.
    const stranger = await newPlan("Stranger's own", "2026-06-10");
    expect(titles((await mine(stranger.host)).upcoming)).toEqual(["Stranger's own"]);
    expect(await mine(undefined)).toEqual({ upcoming: [], recent: [] });
    expect(await mine("unknown-token")).toEqual({ upcoming: [], recent: [] });
  });

  it("leaves out cancelled plans and rejected or removed responses", async () => {
    const called = await newPlan("Called off");
    await cancelPlan(deps, { planId: called.planId, deviceToken: called.host });
    const device = called.host;
    const rejectedPlan = await newPlan("Rejected");
    const rejected = await respondTo(rejectedPlan.planId, "requested", device);
    await rejectRequest(deps, {
      planId: rejectedPlan.planId,
      deviceToken: rejectedPlan.host,
      responseId: rejected.responseId,
    });
    const removedPlan = await newPlan("Removed");
    const removed = await respondTo(removedPlan.planId, "requested", device);
    await acceptRequest(deps, {
      planId: removedPlan.planId,
      deviceToken: removedPlan.host,
      responseId: removed.responseId,
    });
    await removePerson(deps, {
      planId: removedPlan.planId,
      deviceToken: removedPlan.host,
      responseId: removed.responseId,
    });
    await newPlan("Kept", "2026-06-07", device);
    expect(titles((await mine(device)).upcoming)).toEqual(["Kept"]);
  });

  it("lists a plan that is both hosted and answered once, as host, in either order", async () => {
    const plan = await newPlan("Both");
    const host = { plan: await planOf(plan.planId), role: "host" as const };
    const answer = await manageEntry(plan.planId, "interested");
    for (const entries of [
      [answer, host],
      [host, answer],
    ]) {
      const { upcoming } = await listMyPlans(linked(entries), { deviceToken: plan.host });
      expect(upcoming.map((item) => [item.title, item.role])).toEqual([["Both", "host"]]);
    }
  });

  it("shows the furthest of several responses to one plan: joined, then requested, then interested", async () => {
    const plan = await newPlan("Many");
    const interested = await manageEntry(plan.planId, "interested");
    const requested = await manageEntry(plan.planId, "requested");
    const joined = await manageEntry(plan.planId, "joined");
    for (const entries of [
      [interested, requested, joined],
      [joined, requested, interested],
      [requested, joined, interested],
    ]) {
      const { upcoming } = await listMyPlans(linked(entries), { deviceToken: plan.host });
      expect(upcoming.map((item) => item.role)).toEqual(["joined"]);
    }
    for (const entries of [
      [interested, requested],
      [requested, interested],
    ]) {
      const { upcoming } = await listMyPlans(linked(entries), { deviceToken: plan.host });
      expect(upcoming.map((item) => item.role)).toEqual(["requested"]);
    }
  });

  it("leaves out a cancelled plan the device only answered", async () => {
    const other = await newPlan("Cancelled elsewhere");
    const me = await newPlan("Mine");
    await respondTo(other.planId, "interested", me.host);
    await cancelPlan(deps, { planId: other.planId, deviceToken: other.host });
    expect(titles((await mine(me.host)).upcoming)).toEqual(["Mine"]);
  });

  it("includes link-only plans, which are the visitor's own", async () => {
    const plan = await newPlan("Link only");
    expect((await repos.plans.findById(plan.planId))?.visibility).toBe("link");
    expect(titles((await mine(plan.host)).upcoming)).toEqual(["Link only"]);
  });

  it("splits coming up (soonest first) from the last week (newest first), older left out", async () => {
    const first = await newPlan("Later", "2026-06-12");
    await newPlan("Soon", "2026-06-11", first.host);
    await newPlan("Yesterday", "2026-06-09", first.host);
    await newPlan("Last week", "2026-06-04", first.host);
    await newPlan("Too old", "2026-06-02", first.host);
    clock.set("2026-06-10T08:00:00Z");
    const { upcoming, recent } = await mine(first.host);
    expect(titles(upcoming)).toEqual(["Soon", "Later"]);
    expect(titles(recent)).toEqual(["Yesterday", "Last week"]);
  });

  it("lists at most ten coming up and five recent plans", async () => {
    const first = await newPlan("Day 0", "2026-06-21");
    for (let day = 1; day < MAX_COMING_UP + 2; day++) {
      await newPlan(`Day ${day}`, dayOf(21 + day), first.host);
    }
    for (let day = 1; day <= MAX_RECENT + 1; day++) {
      await newPlan(`Past ${day}`, dayOf(20 - day), first.host);
    }
    clock.set("2026-06-20T08:00:00Z");
    const { upcoming, recent } = await mine(first.host);
    expect(upcoming).toHaveLength(MAX_COMING_UP);
    expect(upcoming[0]?.title).toBe("Day 0");
    expect(upcoming[MAX_COMING_UP - 1]?.title).toBe(`Day ${MAX_COMING_UP - 1}`);
    expect(recent).toHaveLength(MAX_RECENT);
    expect(recent[0]?.title).toBe("Past 1");
    expect(recent[MAX_RECENT - 1]?.title).toBe(`Past ${MAX_RECENT}`);
  });

  it("starts the last week exactly seven days back, and a start now is coming up", async () => {
    const plan = await newPlan("Edge", "2026-06-08");
    const start = (await planOf(plan.planId)).startsAt.getTime();
    clock.set(new Date(start + 7 * 24 * 60 * 60 * 1000));
    expect(titles((await mine(plan.host)).recent)).toEqual(["Edge"]);
    clock.set(new Date(start + 7 * 24 * 60 * 60 * 1000 + 1));
    expect(await mine(plan.host)).toEqual({ upcoming: [], recent: [] });
    clock.set(new Date(start));
    const now = await mine(plan.host);
    expect(titles(now.upcoming)).toEqual(["Edge"]);
    expect(now.recent).toEqual([]);
  });

  it("follows the account: another device on the identity lists its plans, until it leaves", async () => {
    const a = await newPlan("Phone plan");
    const b = await newPlan("Laptop plan");
    const deviceA = await deps.devices.findByTokenHash(deps.tokens.hash(a.host ?? ""));
    const deviceB = await deps.devices.findByTokenHash(deps.tokens.hash(b.host ?? ""));
    if (deviceA === undefined || deviceB === undefined) throw new Error("no device");
    expect(titles((await mine(b.host)).upcoming)).toEqual(["Laptop plan"]);
    await deps.devices.setIdentity(deviceA.id, "identity-1");
    await deps.devices.setIdentity(deviceB.id, "identity-1");
    await deps.devices.claimInto(deviceA.id, "identity-1");
    const joined = await mine(b.host);
    expect(joined.upcoming.map((item) => [item.title, item.role])).toEqual([
      ["Phone plan", "host"],
      ["Laptop plan", "host"],
    ]);
    await deps.devices.setIdentity(deviceB.id, undefined);
    expect(titles((await mine(b.host)).upcoming)).toEqual(["Laptop plan"]);
  });

  it("carries nothing private", async () => {
    const plan = await newPlan("Run");
    const items = JSON.stringify(await mine(plan.host));
    expect(items).not.toContain("North gate");
    expect(items).not.toContain("Bring water");
    expect(items).not.toContain("Anna");
  });
});
