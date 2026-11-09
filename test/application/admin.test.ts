// The instance admin's use cases (spec 7 Moderation, 3.10).
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  type AdminDeps,
  deletePlanAsAdmin,
  isAdmin,
  logInAsAdmin,
  viewPlanAsAdmin,
} from "../../src/application/admin.ts";
import { subscribe } from "../../src/application/channels.ts";
import { createPlan } from "../../src/application/plans.ts";
import { respond } from "../../src/application/responses.ts";
import { listTemplates } from "../../src/application/templates.ts";
import { FakeAdminAuth } from "../fakes/admin-auth.ts";
import { FakeChannelRepository } from "../fakes/channels.ts";
import { FakeClock } from "../fakes/clock.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { FakeJobQueue } from "../fakes/job-queue.ts";
import { FakeSentReminders } from "../fakes/reminders.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

let deps: AdminDeps;
let session: string;
let clock: FakeClock;
let jobs: FakeJobQueue;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;

beforeEach(() => {
  jobs = new FakeJobQueue();
  clock = new FakeClock(fixtureNow);
  deps = {
    ...createFakeRepositories(),
    routeParser: new FakeRouteParser(),
    tokens: new FakeTokenService(),
    ids: new SequentialIdGenerator(),
    clock,
    limits: { horizonDays: 180, maxRetentionDays: 30 },
    notify: { channels: new FakeChannelRepository(), jobs, reminders: new FakeSentReminders() },
    adminAuth: new FakeAdminAuth("the-admin-token"),
  };
  const loggedIn = logInAsAdmin(deps, { token: "the-admin-token" });
  if (loggedIn.kind !== "logged_in") throw new Error("login failed");
  session = loggedIn.session.value;
});

async function newPlan(input = {}) {
  const created = await createPlan(deps, {
    input: { ...sampleInput, ...input },
    units: "metric",
    language: "en",
    creationNonce: nonce(),
    deviceToken: undefined,
  });
  if (created.kind !== "created") throw new Error("setup failed");
  return created;
}

describe("the instance admin (spec 7 Moderation)", () => {
  it("logs in only with the right token, for 12 hours", () => {
    expect(logInAsAdmin(deps, { token: "wrong" })).toEqual({ kind: "refused" });
    expect(isAdmin(deps, { session })).toBe(true);
    expect(isAdmin(deps, { session: undefined })).toBe(false);
    expect(isAdmin(deps, { session: "made-up" })).toBe(false);
    clock.advance({ hours: 12 });
    expect(isAdmin(deps, { session })).toBe(false);
  });

  it("does nothing without the admin session", async () => {
    const { planId } = await newPlan();
    for (const without of [undefined, "made-up"]) {
      expect(await viewPlanAsAdmin(deps, { planId, session: without })).toEqual({
        kind: "not_admin",
      });
      expect(await deletePlanAsAdmin(deps, { planId, session: without })).toEqual({
        kind: "not_admin",
      });
    }
    expect(await deps.plans.findById(planId)).toBeDefined();
  });

  it("sees only the public fields the admin page names (spec 3.6)", async () => {
    const { planId } = await newPlan();
    const found = await viewPlanAsAdmin(deps, { planId, session });
    if (found.kind !== "found") throw new Error("not found");
    expect(Object.keys(found.view).sort()).toEqual([
      "activity",
      "areaLabel",
      "counts",
      "deleteAt",
      "id",
      "posterName",
      "startsAt",
      "status",
      "timeZone",
      "title",
    ]);
    expect(found.view.title).toBe("Easy Sunday run");
    expect(Object.keys(found.view.counts).sort()).toEqual(["interested", "participants"]);
    expect(await viewPlanAsAdmin(deps, { planId: "nope", session })).toEqual({
      kind: "not_found",
    });
  });

  it("deletes any plan, telling those still in an upcoming plan, never keeping a template", async () => {
    const created = await newPlan({ keepAsTemplate: "1" });
    const { planId } = created;
    const responded = await respond(deps, {
      planId,
      choice: "joined",
      displayName: "Ben",
      requestNote: "",
      language: "en",
      creationNonce: nonce(),
      deviceToken: undefined,
    });
    if (responded.kind !== "created") throw new Error("respond failed");
    await subscribe(deps, {
      planId,
      deviceToken: responded.newDeviceToken,
      role: "responder",
      subscription: {
        endpoint: "https://fcm.googleapis.com/fcm/send/ben",
        keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
      },
    });
    jobs.jobs.clear();

    expect(await deletePlanAsAdmin(deps, { planId, session })).toEqual({ kind: "deleted" });
    expect(await deps.plans.findById(planId)).toBeUndefined();
    const queued = [...jobs.jobs.values()].map((job) => JSON.stringify(job.payload));
    expect(queued).toHaveLength(1);
    expect(queued[0]).toContain('"deleted"');
    expect(await listTemplates(deps, { deviceToken: created.newDeviceToken })).toEqual([]);
    expect(await deletePlanAsAdmin(deps, { planId, session })).toEqual({ kind: "not_found" });
  });
});
