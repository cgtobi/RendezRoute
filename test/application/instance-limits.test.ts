// Instance-wide caps on new plans and the disk guard (0.19.0 commit A, ADR 009).
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { editPlan } from "../../src/application/host.ts";
import { createInstanceLimits } from "../../src/application/instance-limits.ts";
import { createPlan, type PlanDeps } from "../../src/application/plans.ts";
import { createStorageGuard } from "../../src/application/storage-guard.ts";
import { repeatTemplate, saveAsTemplate } from "../../src/application/templates.ts";
import { planToInput } from "../../src/domain/plan-edit.ts";
import type { StorageLevel } from "../../src/domain/instance-limits.ts";
import { FakeClock } from "../fakes/clock.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { fakeGpx, FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeStorageStatus } from "../fakes/storage-status.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

const GiB = 1024 ** 3;
let deps: PlanDeps;
let repos: ReturnType<typeof createFakeRepositories>;
let clock: FakeClock;
let level: StorageLevel;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;

beforeEach(() => {
  repos = createFakeRepositories();
  clock = new FakeClock(fixtureNow);
  level = "ok";
  deps = {
    ...repos,
    routeParser: new FakeRouteParser(),
    tokens: new FakeTokenService(),
    ids: new SequentialIdGenerator(),
    clock,
    limits: { horizonDays: 180, maxRetentionDays: 30 },
    postingMode: "anyone",
    instanceLimits: createInstanceLimits({ maxNewPlansPerDay: 200, storage: () => level }),
  };
});

const create = (gpx?: Uint8Array) =>
  createPlan(deps, {
    input: sampleInput,
    units: "metric",
    language: "en",
    creationNonce: nonce(),
    deviceToken: undefined,
    gpx,
  });

async function createMany(count: number) {
  for (let i = 0; i < count; i++) {
    expect((await create()).kind).toBe("created");
  }
}

describe("the instance cap on new plans", () => {
  it("allows 40 an hour, then answers busy until the hour has passed", async () => {
    await createMany(40);
    expect(await create()).toEqual({ kind: "busy", retryAfterSeconds: 900 });
    expect(await repos.plans.countCreatedSince({ hour: new Date(0), day: new Date(0) })).toEqual({
      lastHour: 40,
      lastDay: 40,
    });
    clock.advance({ minutes: 61 });
    expect((await create()).kind).toBe("created");
  });

  it("allows 200 in a rolling day", async () => {
    for (let hour = 0; hour < 5; hour++) {
      await createMany(40);
      clock.advance({ minutes: 61 });
    }
    // 200 plans in the last 5 hours: the daily cap holds although the hourly one has room.
    expect(await create()).toEqual({ kind: "busy", retryAfterSeconds: 3600 });
    clock.advance({ hours: 19 });
    expect((await create()).kind).toBe("created");
  });

  it("can only be lowered: MAX_NEW_PLANS_PER_DAY gives a lower daily and hourly cap", async () => {
    deps = {
      ...deps,
      instanceLimits: createInstanceLimits({ maxNewPlansPerDay: 3, storage: () => level }),
    };
    await createMany(3);
    expect((await create()).kind).toBe("busy");
  });

  it("pauses new plans with 0", async () => {
    deps = {
      ...deps,
      instanceLimits: createInstanceLimits({ maxNewPlansPerDay: 0, storage: () => level }),
    };
    expect((await create()).kind).toBe("busy");
    expect(await repos.plans.countCreatedSince({ hour: new Date(0), day: new Date(0) })).toEqual({
      lastHour: 0,
      lastDay: 0,
    });
  });

  it("is counted from the stored plans, not from this process", async () => {
    await createMany(3);
    // A restarted process has fresh deps but the same rows.
    deps = {
      ...deps,
      instanceLimits: createInstanceLimits({ maxNewPlansPerDay: 3, storage: () => level }),
    };
    expect((await create()).kind).toBe("busy");
  });

  it("lets only one of two parallel creates take the last place", async () => {
    deps = {
      ...deps,
      instanceLimits: createInstanceLimits({ maxNewPlansPerDay: 3, storage: () => level }),
    };
    await createMany(2);
    const kinds = (await Promise.all([create(), create()])).map((result) => result.kind);
    expect(kinds.toSorted()).toEqual(["busy", "created"]);
    expect(await repos.plans.countCreatedSince({ hour: new Date(0), day: new Date(0) })).toEqual({
      lastHour: 3,
      lastDay: 3,
    });
  });

  it("gives the place back when a create fails, so the last place is still free", async () => {
    deps = {
      ...deps,
      instanceLimits: createInstanceLimits({ maxNewPlansPerDay: 3, storage: () => level }),
    };
    await createMany(2);
    const working = deps;
    deps = {
      ...deps,
      plans: {
        ...deps.plans,
        create: () => Promise.reject(new Error("disk full")),
      },
    };
    await expect(create()).rejects.toThrow("disk full");
    deps = working;
    expect((await create()).kind).toBe("created");
    expect((await create()).kind).toBe("busy");
  });

  it("does not turn away a form that was sent twice", async () => {
    deps = {
      ...deps,
      instanceLimits: createInstanceLimits({ maxNewPlansPerDay: 1, storage: () => level }),
    };
    const sent = nonce();
    const first = await createPlan(deps, {
      input: sampleInput,
      units: "metric",
      language: "en",
      creationNonce: sent,
      deviceToken: undefined,
    });
    expect(first.kind).toBe("created");
    const again = await createPlan(deps, {
      input: sampleInput,
      units: "metric",
      language: "en",
      creationNonce: sent,
      deviceToken: undefined,
    });
    expect(again.kind).toBe("duplicate");
  });

  it("checks the posting rules first", async () => {
    deps = {
      ...deps,
      postingMode: "invite",
      instanceLimits: createInstanceLimits({ maxNewPlansPerDay: 0, storage: () => level }),
    };
    expect((await create()).kind).toBe("not_allowed");
  });

  it("also stops Repeat of a template, and nothing else", async () => {
    const first = await create();
    if (first.kind !== "created") throw new Error("not created");
    const device = first.newDeviceToken;
    const saved = await saveAsTemplate(deps, {
      planId: first.planId,
      deviceToken: device,
      includePrivate: false,
      creationNonce: nonce(),
    });
    if (saved.kind !== "saved") throw new Error(`not saved: ${saved.kind}`);
    deps = {
      ...deps,
      instanceLimits: createInstanceLimits({ maxNewPlansPerDay: 1, storage: () => level }),
    };
    const repeat = () =>
      repeatTemplate(deps, {
        templateId: saved.templateId,
        deviceToken: device,
        date: "2026-06-14",
        time: "08:00",
        units: "metric",
        creationNonce: nonce(),
      });
    expect(await repeat()).toEqual({ kind: "busy", retryAfterSeconds: 3600 });
    // Managing the plan still works at the cap.
    const edited = await editPlan(deps, {
      planId: first.planId,
      deviceToken: device,
      input: planToInput((await repos.plans.findById(first.planId))!, "metric"),
      units: "metric",
      confirmDeleteNow: false,
    });
    expect(edited.kind).toBe("updated");
    deps = {
      ...deps,
      instanceLimits: createInstanceLimits({ maxNewPlansPerDay: 200, storage: () => level }),
    };
    expect((await repeat()).kind).toBe("created");
  });
});

describe("the disk guard's effect", () => {
  it("refuses new plans only at the critical level", async () => {
    level = "low";
    expect((await create()).kind).toBe("created");
    level = "critical";
    expect((await create()).kind).toBe("busy");
    level = "ok";
    expect((await create()).kind).toBe("created");
  });

  it("refuses a route file in a host edit at the critical level, and only that", async () => {
    const first = await create();
    if (first.kind !== "created") throw new Error("not created");
    const plan = (await repos.plans.findById(first.planId))!;
    const gpx = fakeGpx({
      segments: [
        [
          { lat: 48.1631, lng: 11.6014 },
          { lat: 48.17, lng: 11.61 },
        ],
      ],
    });
    const save = (route?: { gpx: Uint8Array; trim: string }) =>
      editPlan(deps, {
        planId: first.planId,
        deviceToken: first.newDeviceToken,
        input: { ...planToInput(plan, "metric"), title: "Renamed" },
        units: "metric",
        confirmDeleteNow: false,
        route,
      });
    level = "critical";
    expect(await save({ gpx, trim: "" })).toEqual({
      kind: "invalid",
      errors: [{ field: "gpx", code: "storage_low" }],
    });
    expect((await save()).kind).toBe("updated");
    level = "low";
    expect((await save({ gpx, trim: "" })).kind).toBe("updated");
  });
});

describe("createStorageGuard", () => {
  const sample = (free: number, total: number) => ({ freeBytes: free, totalBytes: total });
  const setup = (first: ConstructorParameters<typeof FakeStorageStatus>[0]) => {
    const status = new FakeStorageStatus(first);
    const events: string[] = [];
    const guard = createStorageGuard({
      status,
      onChange: (now, before) => events.push(`${before}>${now}`),
      onUnavailable: () => events.push("unavailable"),
    });
    return { status, events, guard };
  };

  it("is ok before the first sample", () => {
    expect(setup(sample(0, 10 * GiB)).guard.level()).toBe("ok");
  });

  it("caches the level and reports each change once", async () => {
    const { status, events, guard } = setup(sample(1 * GiB, 20 * GiB));
    await guard.sample();
    await guard.sample();
    expect(guard.level()).toBe("low");
    expect(events).toEqual(["ok>low"]);
    status.next = sample(100 * 1024 ** 2, 20 * GiB);
    await guard.sample();
    expect(guard.level()).toBe("critical");
    status.next = sample(10 * GiB, 20 * GiB);
    await guard.sample();
    expect(guard.level()).toBe("ok");
    expect(events).toEqual(["ok>low", "low>critical", "critical>ok"]);
    // Reading the level never reads the disk.
    const reads = status.reads;
    guard.level();
    expect(status.reads).toBe(reads);
  });

  it("treats a failed or empty reading as ok and warns once until it works again", async () => {
    const { status, events, guard } = setup(new Error("statfs failed"));
    await guard.sample();
    await guard.sample();
    expect(guard.level()).toBe("ok");
    status.next = undefined;
    await guard.sample();
    expect(events).toEqual(["unavailable"]);
    status.next = sample(10 * GiB, 20 * GiB);
    await guard.sample();
    status.next = new Error("again");
    await guard.sample();
    expect(events).toEqual(["unavailable", "unavailable"]);
  });

  it("goes back to ok when the reading fails after a low one", async () => {
    const { status, guard } = setup(sample(1 * GiB, 20 * GiB));
    await guard.sample();
    status.next = new Error("gone");
    await guard.sample();
    expect(guard.level()).toBe("ok");
  });
});

describe("refusals are reported for the hourly summary", () => {
  it("tells onRefusal about a busy answer and a full disk, not about plans taken", async () => {
    let refused = 0;
    deps = {
      ...deps,
      instanceLimits: createInstanceLimits({
        maxNewPlansPerDay: 1,
        storage: () => level,
        onRefusal: () => {
          refused += 1;
        },
      }),
    };
    expect((await create()).kind).toBe("created");
    expect(refused).toBe(0);
    expect((await create()).kind).toBe("busy");
    level = "critical";
    expect((await create()).kind).toBe("busy");
    expect(refused).toBe(2);
  });
});
