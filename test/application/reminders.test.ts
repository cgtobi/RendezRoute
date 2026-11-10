// Day-before and deletion reminders, deletion notices (spec 6 feature 3, 3.10, decision I39).
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { subscribe } from "../../src/application/channels.ts";
import {
  acceptRequest,
  cancelPlan,
  deletePlan,
  editPlan,
  rejectRequest,
  removePerson,
} from "../../src/application/host.ts";
import type { JobOutcome } from "../../src/application/jobs.ts";
import { notificationHandler } from "../../src/application/notifications.ts";
import { createPlan, type PlanDeps } from "../../src/application/plans.ts";
import { reminderStillDue, runReminders } from "../../src/application/reminders.ts";
import { respond } from "../../src/application/responses.ts";
import { planToInput } from "../../src/domain/plan-edit.ts";
import { FakeChannelRepository } from "../fakes/channels.ts";
import { FakeClock } from "../fakes/clock.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { FakeJobQueue } from "../fakes/job-queue.ts";
import { FakeNotifier } from "../fakes/notifier.ts";
import { FakeSentReminders } from "../fakes/reminders.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

// sampleInput starts on 7 June 2026 at 07:30 in Berlin (05:30 UTC); 14 days, recap 1 week.
const DAY_BEFORE = "2026-06-06T16:00:00Z";
const DELETION_REMINDER = "2026-06-19T05:30:00Z";

let deps: PlanDeps;
let repos: ReturnType<typeof createFakeRepositories>;
let clock: FakeClock;
let channels: FakeChannelRepository;
let jobs: FakeJobQueue;
let planId: string;
let host: string | undefined;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;

async function newPlan(): Promise<{ planId: string; host: string | undefined }> {
  const created = await createPlan(deps, {
    input: { ...sampleInput, joinMode: "approval" },
    units: "metric",
    language: "de",
    creationNonce: nonce(),
    deviceToken: undefined,
  });
  if (created.kind !== "created") throw new Error("setup failed");
  return { planId: created.planId, host: created.newDeviceToken };
}

beforeEach(async () => {
  repos = createFakeRepositories();
  clock = new FakeClock(fixtureNow);
  channels = new FakeChannelRepository();
  jobs = new FakeJobQueue();
  deps = {
    ...repos,
    routeParser: new FakeRouteParser(),
    tokens: new FakeTokenService(),
    ids: new SequentialIdGenerator(),
    clock,
    limits: { horizonDays: 180, maxRetentionDays: 30 },
    postingMode: "anyone",
    notify: { channels, jobs, reminders: new FakeSentReminders() },
  };
  ({ planId, host } = await newPlan());
});

const subscription = (name: string) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
  keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
});

async function person(name: string, choice: string, { notify = true } = {}) {
  const result = await respond(deps, {
    planId,
    choice,
    displayName: name,
    requestNote: "",
    language: "fr",
    creationNonce: nonce(),
    deviceToken: undefined,
  });
  if (result.kind !== "created") throw new Error(`respond failed: ${result.kind}`);
  const response = await repos.responses.findByManageTokenHash(
    deps.tokens.hash(result.manageToken),
  );
  const device = result.newDeviceToken;
  const turnOn = () =>
    subscribe(deps, {
      planId,
      deviceToken: device,
      role: "responder",
      subscription: subscription(name),
    });
  if (notify) await turnOn();
  return { responseId: response?.id ?? "", device, turnOn };
}

const subscribeHost = () =>
  subscribe(deps, { planId, deviceToken: host, role: "host", subscription: subscription("anna") });

/** Notifications queued since the last call, as "kind recipient-endpoint-name". */
function takeQueued(): string[] {
  const queued = [...jobs.jobs.values()].map((job) => {
    const payload = job.payload as {
      to: { channelId?: string; subscription?: { endpoint: string } };
      notification: { kind: string };
    };
    const channel =
      payload.to.channelId === undefined ? undefined : channels.channels.get(payload.to.channelId);
    const endpoint = payload.to.subscription?.endpoint ?? channel?.subscription.endpoint ?? "";
    return `${payload.notification.kind} ${endpoint.split("/").pop() ?? ""}`;
  });
  jobs.jobs.clear();
  return queued.sort();
}

/** Runs the queued jobs as the job runner would, with the reminder check of main.ts. */
async function deliverQueued(): Promise<JobOutcome[]> {
  const handler = notificationHandler({
    notifier: new FakeNotifier(),
    stillDue: (reminder) => reminderStillDue(deps, reminder),
  });
  const outcomes: JobOutcome[] = [];
  for (const job of jobs.jobs.values()) outcomes.push(await handler(job.payload));
  jobs.jobs.clear();
  return outcomes;
}

async function sweepAt(time: string) {
  clock.set(time);
  return runReminders(deps);
}

async function edit(changes: Record<string, string>) {
  const plan = await repos.plans.findById(planId);
  if (plan === undefined) throw new Error("missing plan");
  const result = await editPlan(deps, {
    planId,
    deviceToken: host,
    input: { ...planToInput(plan, "metric"), ...changes },
    units: "metric",
    confirmDeleteNow: false,
  });
  if (result.kind !== "updated") throw new Error(`edit failed: ${result.kind}`);
}

describe("the day-before reminder (spec 6 feature 3)", () => {
  it("goes at 18:00 the day before to participants and interested people with a channel, once", async () => {
    const ben = await person("ben", "requested");
    await acceptRequest(deps, { planId, deviceToken: host, responseId: ben.responseId });
    await person("ida", "interested");
    await person("pia", "requested");
    const rex = await person("rex", "requested");
    await rejectRequest(deps, { planId, deviceToken: host, responseId: rex.responseId });
    await person("tom", "interested", { notify: false });
    await subscribeHost();
    takeQueued();

    expect(await sweepAt("2026-06-06T15:59:00Z")).toEqual({ dayBefore: 0, deletion: 0 });
    expect(takeQueued()).toEqual([]);
    expect(await sweepAt(DAY_BEFORE)).toEqual({ dayBefore: 2, deletion: 0 });
    expect(takeQueued()).toEqual(["dayBefore ben", "dayBefore ida"]);
    await sweepAt("2026-06-06T16:01:00Z");
    expect(takeQueued()).toEqual([]);
  });

  it("reaches people who join or turn notifications on later, until 3 hours before the start", async () => {
    const tom = await person("tom", "interested", { notify: false });
    await sweepAt(DAY_BEFORE);
    await tom.turnOn();
    await person("ida", "interested");
    takeQueued();
    await sweepAt("2026-06-06T20:00:00Z");
    expect(takeQueued()).toEqual(["dayBefore ida", "dayBefore tom"]);

    clock.set("2026-06-07T03:00:00Z");
    await person("lea", "interested");
    takeQueued();
    await sweepAt("2026-06-07T03:00:00Z");
    expect(takeQueued()).toEqual([]);
  });

  it("says today instead of tomorrow to people who join after midnight", async () => {
    clock.set("2026-06-06T21:00:00Z"); // 23:00 in Berlin
    await person("ida", "interested");
    takeQueued();
    await sweepAt("2026-06-06T21:00:00Z");
    expect(takeQueued()).toEqual(["dayBefore ida"]);
    clock.set("2026-06-07T00:30:00Z"); // 02:30 in Berlin
    await person("tom", "interested");
    takeQueued();
    await sweepAt("2026-06-07T00:30:00Z");
    expect(takeQueued()).toEqual(["startsToday tom"]);
  });

  it("expires at the start, so a late retry never arrives afterwards", async () => {
    await person("ida", "interested");
    takeQueued();
    await sweepAt(DAY_BEFORE);
    expect([...jobs.jobs.values()].map((job) => job.expiresAt)).toEqual([
      new Date("2026-06-07T05:30:00Z"),
    ]);
  });

  it("comes again for a new day when the start moves, not when only the time changes", async () => {
    await person("ida", "interested");
    await sweepAt(DAY_BEFORE);
    takeQueued();
    clock.set("2026-06-06T17:00:00Z");
    await edit({ time: "09:00" });
    takeQueued();
    await sweepAt("2026-06-06T17:01:00Z");
    expect(takeQueued()).toEqual([]);

    await edit({ date: "2026-06-08" });
    takeQueued();
    await sweepAt("2026-06-07T16:00:00Z");
    expect(takeQueued()).toEqual(["dayBefore ida"]);
  });

  it("is not sent for cancelled plans", async () => {
    await person("ida", "interested");
    await cancelPlan(deps, { planId, deviceToken: host });
    takeQueued();
    await sweepAt(DAY_BEFORE);
    expect(takeQueued()).toEqual([]);
  });
});

describe("the deletion reminder (spec 3.10)", () => {
  it("goes to the host and participants with a channel, each once, at the later of two days before deletion and the recap close", async () => {
    const ben = await person("ben", "requested");
    await acceptRequest(deps, { planId, deviceToken: host, responseId: ben.responseId });
    const tom = await person("tom", "requested", { notify: false });
    await acceptRequest(deps, { planId, deviceToken: host, responseId: tom.responseId });
    await person("ida", "interested");
    await subscribeHost();
    takeQueued();

    await sweepAt("2026-06-19T05:29:00Z");
    expect(takeQueued()).toEqual([]);
    expect(await sweepAt(DELETION_REMINDER)).toEqual({ dayBefore: 0, deletion: 2 });
    expect(takeQueued()).toEqual(["deletionReminder anna", "deletionReminder ben"]);
    await sweepAt("2026-06-19T06:00:00Z");
    expect(takeQueued()).toEqual([]);
    // Turning notifications on later still brings it.
    await tom.turnOn();
    takeQueued();
    expect(await sweepAt("2026-06-19T07:00:00Z")).toEqual({ dayBefore: 0, deletion: 1 });
    expect(takeQueued()).toEqual(["deletionReminder tom"]);
  });

  it("is not counted when nobody has notifications on", async () => {
    expect(await sweepAt(DELETION_REMINDER)).toEqual({ dayBefore: 0, deletion: 0 });
  });

  it("follows a changed retention", async () => {
    await subscribeHost();
    await edit({ retentionDays: "20" });
    takeQueued();
    await sweepAt(DELETION_REMINDER);
    expect(takeQueued()).toEqual([]);
    await sweepAt("2026-06-25T05:30:00Z");
    expect(takeQueued()).toEqual(["deletionReminder anna"]);
  });

  it("comes again when retention changes after it went out", async () => {
    await subscribeHost();
    await sweepAt(DELETION_REMINDER);
    expect(takeQueued()).toEqual(["deletionReminder anna"]);
    await edit({ retentionDays: "20" });
    takeQueued();
    await sweepAt("2026-06-25T05:30:00Z");
    expect(takeQueued()).toEqual(["deletionReminder anna"]);
  });

  it("comes once per deletion date, even when the recap window changes after it went out", async () => {
    await subscribeHost();
    await sweepAt(DELETION_REMINDER);
    expect(takeQueued()).toEqual(["deletionReminder anna"]);
    // Measured from now after the start: the recap now closes on 20 June, before the deletion.
    await edit({ recapWindow: "1d" });
    takeQueued();
    await sweepAt("2026-06-20T05:30:00Z");
    expect(takeQueued()).toEqual([]);
  });
});

describe("queued reminders (decision I39)", () => {
  it("are delivered while still due", async () => {
    await person("ida", "interested");
    await subscribeHost();
    takeQueued();
    await sweepAt(DAY_BEFORE);
    expect(await deliverQueued()).toEqual(["done"]);
    await sweepAt(DELETION_REMINDER);
    expect(await deliverQueued()).toEqual(["done"]);
  });

  it("are dropped for someone removed since, or when the plan was cancelled", async () => {
    const ben = await person("ben", "requested");
    await acceptRequest(deps, { planId, deviceToken: host, responseId: ben.responseId });
    await person("ida", "interested");
    takeQueued();
    await sweepAt(DAY_BEFORE);
    await removePerson(deps, { planId, deviceToken: host, responseId: ben.responseId });
    // Ben's reminder, Ida's reminder, Ben's removal notice.
    expect(await deliverQueued()).toEqual(["drop", "done", "done"]);

    await person("lea", "interested");
    takeQueued();
    await sweepAt("2026-06-06T16:10:00Z");
    await cancelPlan(deps, { planId, deviceToken: host });
    // Lea's reminder, then the cancellation notices for Ida and Lea.
    expect(await deliverQueued()).toEqual(["drop", "done", "done"]);
  });

  it("are dropped when the start moved to another day", async () => {
    await person("ida", "interested");
    takeQueued();
    await sweepAt(DAY_BEFORE);
    const queued = [...jobs.jobs.values()];
    await edit({ date: "2026-06-08" });
    jobs.jobs.clear();
    for (const job of queued) jobs.jobs.set(job.id, job);
    expect(await deliverQueued()).toEqual(["drop"]);
  });
});

describe("the reminder sweep", () => {
  it("keeps going past a plan that fails, then reports the failure", async () => {
    const broken = await repos.plans.findById(planId);
    ({ planId, host } = await newPlan());
    await person("ida", "interested");
    takeQueued();
    // The first plan's zone became unreadable.
    if (broken !== undefined) await repos.plans.update({ ...broken, timeZone: "Nowhere/Never" });
    await expect(sweepAt(DAY_BEFORE)).rejects.toThrow(RangeError);
    expect(takeQueued()).toEqual(["dayBefore ida"]);
  });
});

describe("deletion notices (spec 3.10)", () => {
  it("tell everyone still in when an upcoming plan is deleted, in jobs that outlive the plan for 24 hours", async () => {
    const ben = await person("ben", "requested");
    await acceptRequest(deps, { planId, deviceToken: host, responseId: ben.responseId });
    await person("ida", "interested");
    await person("pia", "requested");
    const rex = await person("rex", "requested");
    await rejectRequest(deps, { planId, deviceToken: host, responseId: rex.responseId });
    await subscribeHost();
    takeQueued();

    clock.set("2026-06-03T10:00:00Z");
    await deletePlan(deps, { planId, deviceToken: host });
    const notices = [...jobs.jobs.values()];
    expect(takeQueued()).toEqual(["deleted ben", "deleted ida", "deleted pia"]);
    for (const job of notices) {
      expect(job.planId).toBeUndefined();
      expect(job.responseId).toBeUndefined();
      expect(job.expiresAt).toEqual(new Date("2026-06-04T10:00:00Z"));
      expect(job.payload).toMatchObject({
        notification: { kind: "deleted", planTitle: sampleInput.title, language: "fr" },
      });
      expect(job.payload).not.toHaveProperty("notification.planPath");
    }
  });

  it("are not sent for a cancelled plan, whose people were told already", async () => {
    await person("ida", "interested");
    await cancelPlan(deps, { planId, deviceToken: host });
    takeQueued();
    await deletePlan(deps, { planId, deviceToken: host });
    expect(takeQueued()).toEqual([]);
  });

  it("are queued only once the plan is actually deleted", async () => {
    await person("ida", "interested");
    takeQueued();
    const plans = deps.plans;
    const failing = Object.assign(Object.create(plans) as typeof plans, {
      deleteMany: () => Promise.reject(new Error("disk full")),
    });
    await expect(
      deletePlan({ ...deps, plans: failing }, { planId, deviceToken: host }),
    ).rejects.toThrow("disk full");
    expect(takeQueued()).toEqual([]);
  });

  it("are not sent once the plan has started", async () => {
    await person("ida", "interested");
    takeQueued();
    clock.set("2026-06-07T06:00:00Z");
    await deletePlan(deps, { planId, deviceToken: host });
    expect(takeQueued()).toEqual([]);
  });
});
