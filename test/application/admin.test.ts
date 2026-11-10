// The instance admin's use cases (spec 7 Moderation, 3.10).
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  type AdminDeps,
  adminOverview,
  deletePlanAsAdmin,
  isAdmin,
  logInAsAdmin,
  resolveReport,
  viewPlanAsAdmin,
} from "../../src/application/admin.ts";
import { reportPlan } from "../../src/application/reports.ts";
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
    postingMode: "anyone",
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
      expect(await adminOverview(deps, { session: without })).toEqual({ kind: "not_admin" });
      expect(await resolveReport(deps, { reportId: "any", session: without })).toEqual({
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

describe("reports for the instance admin (spec 7 Moderation)", () => {
  const report = (planId: string, reason: string, details = "") =>
    reportPlan(deps, {
      planId,
      deviceToken: undefined,
      reason,
      details,
      attach: [],
      nonce: nonce(),
    });

  it("lists open reports oldest first, with their plan's title", async () => {
    const first = await newPlan({ title: "First plan" });
    const second = await newPlan({ title: "Second plan" });
    await report(second.planId, "spam");
    clock.advance({ minutes: 1 });
    await report(first.planId, "unsafe");
    const overview = await adminOverview(deps, { session });
    expect(overview).toEqual({
      kind: "overview",
      openReports: [
        { planId: second.planId, planTitle: "Second plan", reason: "spam" },
        { planId: first.planId, planTitle: "First plan", reason: "unsafe" },
      ],
    });
  });

  it("shows a plan's open reports in full and counts resolved ones; resolving moves one", async () => {
    const { planId } = await newPlan();
    await report(planId, "unsafe", "SENTINEL-details");
    await report(planId, "other");
    const before = await viewPlanAsAdmin(deps, { planId, session });
    if (before.kind !== "found") throw new Error("not found");
    expect(before.reports).toEqual({
      open: [
        {
          id: expect.any(String),
          reason: "unsafe",
          details: "SENTINEL-details",
          attached: [],
          createdAt: fixtureNow,
        },
        {
          id: expect.any(String),
          reason: "other",
          details: undefined,
          attached: [],
          createdAt: fixtureNow,
        },
      ],
      resolved: 0,
    });
    const id = before.reports.open[0]?.id ?? "";
    expect(await resolveReport(deps, { reportId: id, session })).toEqual({
      kind: "resolved",
      planId,
    });
    expect(await resolveReport(deps, { reportId: id, session })).toEqual({
      kind: "already_resolved",
      planId,
    });
    expect(await resolveReport(deps, { reportId: "unknown", session })).toEqual({
      kind: "not_found",
    });
    const after = await viewPlanAsAdmin(deps, { planId, session });
    if (after.kind !== "found") throw new Error("not found");
    expect(after.reports.open.map((r) => r.reason)).toEqual(["other"]);
    expect(after.reports.resolved).toBe(1);
    const overview = await adminOverview(deps, { session });
    expect(overview.kind === "overview" && overview.openReports).toHaveLength(1);
  });

  it("loses a plan's reports when the admin deletes the plan", async () => {
    const { planId } = await newPlan();
    await report(planId, "spam");
    await deletePlanAsAdmin(deps, { planId, session });
    expect(await deps.reports.listOpenForPlan(planId)).toEqual([]);
    expect(await deps.reports.countResolvedForPlan(planId)).toBe(0);
  });
});
