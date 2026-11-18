// The home page's upcoming public plans (spec 7): soonest first, at most ten, public fields only.
import { beforeEach, describe, expect, it } from "vite-plus/test";
import type { PlanDeps } from "../../src/application/plans.ts";
import {
  listPublicRecent,
  listPublicUpcoming,
  MAX_RECENT,
  MAX_UPCOMING,
} from "../../src/application/public-upcoming.ts";
import type { Plan } from "../../src/domain/plan.ts";
import { FakeClock } from "../fakes/clock.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { fixtureNow, samplePlan } from "../fixtures/plans.ts";

let deps: Pick<PlanDeps, "plans" | "clock" | "limits">;
let n = 0;

beforeEach(() => {
  const repos = createFakeRepositories();
  deps = {
    plans: repos.plans,
    clock: new FakeClock(fixtureNow),
    limits: { horizonDays: 180, maxRetentionDays: 30 },
  };
});

async function add(overrides: Partial<Plan>) {
  const plan = samplePlan({
    id: `plan-${++n}`,
    visibility: "public",
    startsAt: new Date("2026-06-07T05:30:00Z"),
    ...overrides,
  });
  await deps.plans.create({
    plan,
    hostTokenHash: `host-${n}`,
    creationNonce: `nonce-${n}`,
    hostDeviceId: "device-1",
  });
  return plan;
}

describe("listing upcoming public plans", () => {
  it("lists the soonest first, without the viewer's distance or anything private", async () => {
    const later = await add({ title: "Later", startsAt: new Date("2026-06-09T05:30:00Z") });
    const sooner = await add({ title: "Sooner", startsAt: new Date("2026-06-03T05:30:00Z") });
    const items = await listPublicUpcoming(deps);
    expect(items.map((item) => item.planId)).toEqual([sooner.id, later.id]);
    expect(items[0]).toEqual({
      planId: sooner.id,
      title: "Sooner",
      activity: sooner.activity,
      startsAt: sooner.startsAt,
      timeZone: sooner.timeZone,
      areaLabel: sooner.area.label,
      distanceMeters: sooner.distanceMeters,
      elevationGainMeters: sooner.elevationGainMeters,
      pace: sooner.pace,
    });
    expect(JSON.stringify(items)).not.toContain("North gate");
  });

  it("leaves out link-only, cancelled, past and too distant plans", async () => {
    const kept = await add({ title: "Kept" });
    await add({ visibility: "link" });
    await add({ status: "cancelled" });
    await add({ startsAt: new Date("2026-05-30T05:30:00Z") });
    await add({ startsAt: new Date("2027-06-07T05:30:00Z") });
    expect((await listPublicUpcoming(deps)).map((item) => item.planId)).toEqual([kept.id]);
  });

  it("leaves out a public plan without an area point", async () => {
    const kept = await add({ title: "Kept" });
    const base = samplePlan({});
    await add({ area: { label: base.area.label, point: undefined } });
    expect((await listPublicUpcoming(deps)).map((item) => item.planId)).toEqual([kept.id]);
  });

  it("includes a plan starting now and excludes one starting at the horizon", async () => {
    const now = await add({ startsAt: fixtureNow });
    await add({ startsAt: new Date(fixtureNow.getTime() + 180 * 24 * 60 * 60 * 1000) });
    expect((await listPublicUpcoming(deps)).map((item) => item.planId)).toEqual([now.id]);
  });

  it("orders plans starting together by id", async () => {
    const b = await add({ id: "b" });
    const a = await add({ id: "a" });
    expect((await listPublicUpcoming(deps)).map((item) => item.planId)).toEqual([a.id, b.id]);
  });

  it("lists at most ten", async () => {
    for (let day = 0; day < MAX_UPCOMING + 3; day++) {
      await add({ startsAt: new Date(Date.UTC(2026, 5, 2 + day, 5, 30)) });
    }
    const items = await listPublicUpcoming(deps);
    expect(items).toHaveLength(10);
    expect(items[9]?.startsAt).toEqual(new Date(Date.UTC(2026, 5, 11, 5, 30)));
  });

  it("is empty without public plans", async () => {
    expect(await listPublicUpcoming(deps)).toEqual([]);
  });
});

describe("listing recent public plans", () => {
  const ago = (days: number) => new Date(fixtureNow.getTime() - days * 24 * 60 * 60 * 1000);
  const ids = async () => (await listPublicRecent(deps)).map((item) => item.planId);

  it("lists the newest first, same starts by id", async () => {
    const older = await add({ startsAt: ago(3) });
    const newer = await add({ startsAt: ago(1) });
    const b = await add({ id: "b", startsAt: ago(2) });
    const a = await add({ id: "a", startsAt: ago(2) });
    expect(await ids()).toEqual([newer.id, a.id, b.id, older.id]);
  });

  it("leaves out cancelled, link-only, older, upcoming and pointless plans", async () => {
    const kept = await add({ startsAt: ago(1) });
    await add({ startsAt: ago(1), status: "cancelled" });
    await add({ startsAt: ago(1), visibility: "link" });
    await add({ startsAt: ago(8) });
    await add({ startsAt: new Date("2026-06-07T05:30:00Z") });
    await add({ startsAt: fixtureNow });
    await add({ startsAt: ago(1), area: { label: samplePlan({}).area.label, point: undefined } });
    expect(await ids()).toEqual([kept.id]);
  });

  it("includes a plan that started exactly a week ago", async () => {
    const edge = await add({ startsAt: ago(7) });
    expect(await ids()).toEqual([edge.id]);
  });

  it("lists at most five, and no private fields", async () => {
    for (let day = 1; day <= MAX_RECENT + 2; day++) await add({ startsAt: ago(day * 0.9) });
    const items = await listPublicRecent(deps);
    expect(items).toHaveLength(5);
    expect(JSON.stringify(items)).not.toContain("North gate");
  });
});
