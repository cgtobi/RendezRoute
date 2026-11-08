import { beforeEach, describe, expect, it } from "vite-plus/test";
import { type JobHandlers, runDueJobs } from "../../src/application/jobs.ts";
import { enqueueNotification, notificationHandler } from "../../src/application/notifications.ts";
import type { Notification } from "../../src/domain/notification.ts";
import { FakeClock } from "../fakes/clock.ts";
import { FakeJobQueue } from "../fakes/job-queue.ts";
import { FakeNotifier } from "../fakes/notifier.ts";

let jobs: FakeJobQueue;
let clock: FakeClock;
beforeEach(() => {
  jobs = new FakeJobQueue();
  clock = new FakeClock("2026-11-08T10:00:00Z");
});

const run = (handlers: JobHandlers) => runDueJobs({ jobs, clock }, handlers);
const enqueue = (runAt = clock.now(), expiresAt?: Date) =>
  jobs.enqueue({ type: "notification", payload: { n: 1 }, runAt, expiresAt });

describe("runDueJobs (spec 6 feature 12: job queue with retries)", () => {
  it("runs due jobs only and removes them when done", async () => {
    await enqueue();
    await enqueue(new Date("2026-11-08T11:00:00Z"));
    const seen: unknown[] = [];
    const result = await run({
      notification: (payload) => (seen.push(payload), Promise.resolve("done")),
    });
    expect(result).toEqual({ done: 1, retried: 0, dropped: 0, expired: 0 });
    expect(seen).toEqual([{ n: 1 }]);
    expect(jobs.jobs.size).toBe(1);
  });

  it("retries failures with backoff and gives up after five retries", async () => {
    await enqueue();
    const failing: JobHandlers = { notification: () => Promise.reject(new TypeError("boom")) };
    const outcomes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const result = await run(failing);
      outcomes.push(result.retried);
      clock.advance({ hours: 6 });
    }
    expect(outcomes).toEqual([1, 1, 1, 1, 1, 0]);
    expect(jobs.jobs.size).toBe(0);
  });

  it("records only the error class, never its message", async () => {
    const id = await enqueue();
    await run({ notification: () => Promise.reject(new TypeError("secret detail")) });
    expect(jobs.jobs.get(id)?.lastError).toBe("TypeError");
    expect(jobs.jobs.get(id)?.runAt).toEqual(new Date("2026-11-08T10:01:00Z"));
  });

  it("treats a handler asking for a retry like a failure", async () => {
    await enqueue();
    expect(await run({ notification: () => Promise.resolve("retry") })).toMatchObject({
      retried: 1,
    });
  });

  it("drops jobs without a handler and expired jobs without running them", async () => {
    await enqueue(clock.now(), new Date("2026-11-08T09:00:00Z"));
    await jobs.enqueue({ type: "unknown" as "notification", payload: {}, runAt: clock.now() });
    const ran: unknown[] = [];
    const result = await run({ notification: (p) => (ran.push(p), Promise.resolve("done")) });
    expect(result).toEqual({ done: 0, retried: 0, dropped: 1, expired: 1 });
    expect(ran).toEqual([]);
    expect(jobs.jobs.size).toBe(0);
  });
});

describe("notifications (spec 6 feature 3, decision I36)", () => {
  const notification: Notification = {
    kind: "cancelled",
    planTitle: "Sunday long run",
    planPath: "/p/abc",
    language: "de",
  };

  it("are delivered as jobs through the notifier", async () => {
    const notifier = new FakeNotifier();
    await enqueueNotification(
      { jobs, clock },
      { channelId: "channel-1", notification, planId: "abc" },
    );
    const result = await run({ notification: notificationHandler({ notifier }) });
    expect(result.done).toBe(1);
    expect(notifier.sent).toEqual([{ channelId: "channel-1", notification }]);
  });

  it("drop a job whose channel is gone and report the channel", async () => {
    const notifier = new FakeNotifier();
    notifier.result = "gone";
    const gone: string[] = [];
    await enqueueNotification({ jobs, clock }, { channelId: "channel-1", notification });
    const handler = notificationHandler({
      notifier,
      onGone: (id) => (gone.push(id), Promise.resolve()),
    });
    expect(await run({ notification: handler })).toMatchObject({ dropped: 1 });
    expect(gone).toEqual(["channel-1"]);
  });

  it("drop a message refused for good, keeping the channel", async () => {
    const notifier = new FakeNotifier();
    notifier.result = "failed";
    const gone: string[] = [];
    await enqueueNotification({ jobs, clock }, { channelId: "channel-1", notification });
    const handler = notificationHandler({
      notifier,
      onGone: (id) => (gone.push(id), Promise.resolve()),
    });
    expect(await run({ notification: handler })).toMatchObject({ dropped: 1 });
    expect(gone).toEqual([]);
  });

  it("retry when the push service is unavailable, and drop malformed payloads", async () => {
    const notifier = new FakeNotifier();
    notifier.result = "retry";
    await enqueueNotification({ jobs, clock }, { channelId: "channel-1", notification });
    await jobs.enqueue({ type: "notification", payload: { channelId: 5 }, runAt: clock.now() });
    expect(await run({ notification: notificationHandler({ notifier }) })).toMatchObject({
      retried: 1,
      dropped: 1,
    });
  });
});
