import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  applyRetentionMax,
  runHousekeeping,
  runRetentionSweep,
} from "../../src/application/maintenance.ts";
import type { PlanDeps } from "../../src/application/plans.ts";
import { FakeBackupStore } from "../fakes/backup-store.ts";
import { FakeClock } from "../fakes/clock.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, samplePlan } from "../fixtures/plans.ts";

let deps: PlanDeps;
let repos: ReturnType<typeof createFakeRepositories>;
let clock: FakeClock;

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

async function addPlan(
  id: string,
  retentionDays: number,
  status: "active" | "cancelled" = "active",
) {
  await repos.devices.create({ id: `device-${id}`, tokenHash: `hash-${id}`, now: fixtureNow });
  const plan = samplePlan({ id, status }, { retentionDays: String(retentionDays) });
  await repos.plans.create({
    plan,
    hostTokenHash: `token-${id}`,
    creationNonce: `nonce-${id}`,
    hostDeviceId: `device-${id}`,
  });
  return plan; // starts 2026-06-07T05:30Z
}

describe("runRetentionSweep (spec 3.10, acceptance criterion v0.1)", () => {
  it("a plan is fully removed within one sweep interval after delete_at", async () => {
    await addPlan("short", 1);
    await addPlan("cancelled", 1, "cancelled");
    await addPlan("long", 14);
    clock.set("2026-06-08T05:29:00Z");
    expect(await runRetentionSweep(deps)).toEqual({ deletedPlans: 0 });
    clock.set("2026-06-08T05:30:00Z");
    expect(await runRetentionSweep(deps)).toEqual({ deletedPlans: 2 });
    expect(await repos.plans.findById("short")).toBeUndefined();
    expect(await repos.plans.findById("cancelled")).toBeUndefined();
    expect(await repos.plans.findById("long")).toBeDefined();
  });
});

describe("runHousekeeping (spec 3.10 Other expiry, decision D9)", () => {
  it("deletes pre-migration backups after 7 days (spec 11)", async () => {
    const backups = new FakeBackupStore(2);
    expect(await runHousekeeping({ ...deps, backups, pendingLogins: repos.pendingLogins })).toEqual(
      {
        deletedTemplates: 0,
        deletedDevices: 0,
        deletedFeeds: 0,
        deletedBackups: 2,
        deletedFormNonces: 0,
        deletedPendingLogins: 0,
      },
    );
    expect(backups.cutoffs).toEqual([new Date(fixtureNow.getTime() - 7 * 24 * 60 * 60 * 1000)]);
  });

  it("deletes unlinked devices after 30 days without activity", async () => {
    await repos.devices.create({ id: "lonely", tokenHash: "lonely-hash", now: fixtureNow });
    await addPlan("p", 14);
    clock.advance({ days: 31 });
    expect(
      await runHousekeeping({
        ...deps,
        backups: new FakeBackupStore(),
        pendingLogins: repos.pendingLogins,
      }),
    ).toEqual({
      deletedTemplates: 0,
      deletedDevices: 1,
      deletedFeeds: 0,
      deletedBackups: 0,
      deletedFormNonces: 0,
      deletedPendingLogins: 0,
    });
    expect(await repos.devices.findByTokenHash("lonely-hash")).toBeUndefined();
    expect(await repos.devices.findByTokenHash("hash-p")).toBeDefined();
  });
});

describe("runHousekeeping and calendar feeds (spec 3.10)", () => {
  it("deletes feeds once they no longer reference anything", async () => {
    await addPlan("p", 14);
    await repos.calendarFeeds.replace({
      id: "feed",
      deviceId: "device-p",
      tokenHash: "feed-hash",
      language: "en",
      createdAt: fixtureNow,
    });
    const housekeeping = () =>
      runHousekeeping({
        ...deps,
        backups: new FakeBackupStore(),
        pendingLogins: repos.pendingLogins,
      });
    expect((await housekeeping()).deletedFeeds).toBe(0);
    await repos.plans.delete("p");
    expect((await housekeeping()).deletedFeeds).toBe(1);
    expect(await repos.calendarFeeds.findByTokenHash("feed-hash")).toBeUndefined();
  });
});

describe("applyRetentionMax (spec 3.10)", () => {
  it("shortens longer retentions and deletes plans whose new date has passed", async () => {
    await addPlan("long", 30);
    await addPlan("medium", 10);
    await addPlan("short", 3);
    clock.set("2026-06-15T00:00:00Z"); // 8 days after the start
    expect(await applyRetentionMax(deps, { maxRetentionDays: 9 })).toEqual({
      shortened: 2,
      deleted: 0,
    });
    expect(await repos.plans.findById("long")).toMatchObject({
      retentionDays: 9,
      deleteAt: new Date("2026-06-16T05:30:00Z"),
    });
    expect(await repos.plans.findById("short")).toMatchObject({ retentionDays: 3 });

    expect(await applyRetentionMax(deps, { maxRetentionDays: 5 })).toEqual({
      shortened: 0,
      deleted: 2,
    });
    expect(await repos.plans.findById("long")).toBeUndefined();
    expect(await repos.plans.findById("short")).toBeDefined();
  });
});
