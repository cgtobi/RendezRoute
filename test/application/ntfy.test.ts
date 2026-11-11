// ntfy for responses and hosted plans (spec 7 Optional notification channels, decision D33): a
// secret topic made by the app, confirmed before first use, turned off from every message.
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  channelConfirmationHandler,
  openChannelLink,
  useChannelLink,
} from "../../src/application/channel-links.ts";
import { subscribe } from "../../src/application/channels.ts";
import { removePerson } from "../../src/application/host.ts";
import { notificationHandler } from "../../src/application/notifications.ts";
import { deletionNotices, notifyResponders } from "../../src/application/notify.ts";
import { ntfySetting, requestNtfy, turnOffNtfy } from "../../src/application/ntfy.ts";
import { createPlan, type PlanDeps } from "../../src/application/plans.ts";
import type {
  ChannelSubject,
  NtfyOutbox,
  NtfyRecipient,
  SendResult,
} from "../../src/application/ports.ts";
import { respond } from "../../src/application/responses.ts";
import { FakeChannelLinks } from "../fakes/channel-links.ts";
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

const SERVER = new URL("https://ntfy.example.org/");
const links = new FakeChannelLinks();

class FakeNtfyOutbox implements NtfyOutbox {
  readonly sent: string[] = [];
  result: SendResult = "sent";
  confirmation(to: NtfyRecipient, about: ChannelSubject) {
    this.sent.push(`confirm ${to.topic} ${about.kind} ${to.language}`);
    return Promise.resolve(this.result);
  }
  accountExpiry(to: NtfyRecipient) {
    this.sent.push(`expiry ${to.topic}`);
    return Promise.resolve(this.result);
  }
}

let deps: PlanDeps;
let repos: ReturnType<typeof createFakeRepositories>;
let channels: FakeChannelRepository;
let jobs: FakeJobQueue;
let outbox: FakeNtfyOutbox;
let planId: string;
let host: string | undefined;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;

function setup(ntfyOn = true) {
  repos = createFakeRepositories();
  channels = new FakeChannelRepository();
  jobs = new FakeJobQueue();
  outbox = new FakeNtfyOutbox();
  deps = {
    ...repos,
    routeParser: new FakeRouteParser(),
    tokens: new FakeTokenService(),
    ids: new SequentialIdGenerator(),
    clock: new FakeClock(fixtureNow),
    limits: { horizonDays: 180, maxRetentionDays: 30 },
    postingMode: "anyone",
    notify: {
      channels,
      jobs,
      reminders: new FakeSentReminders(),
      links,
      ntfy: ntfyOn ? { outbox, server: SERVER } : undefined,
    },
  };
}

beforeEach(async () => {
  setup();
  const created = await createPlan(deps, {
    input: sampleInput,
    units: "metric",
    language: "de",
    creationNonce: nonce(),
    deviceToken: undefined,
  });
  if (created.kind !== "created") throw new Error("setup failed");
  planId = created.planId;
  host = created.newDeviceToken;
});

async function responder(name: string) {
  const result = await respond(deps, {
    planId,
    choice: "joined",
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
  return {
    request: { planId, deviceToken: result.newDeviceToken, role: "responder" as const },
    responseId: response?.id ?? "",
  };
}

/** Runs the queued confirmation jobs; returns the queued notifications as "kind target". */
async function runConfirmations() {
  const handle = channelConfirmationHandler(deps);
  for (const [id, job] of jobs.jobs) {
    if (job.type !== "channelConfirmation") continue;
    jobs.jobs.delete(id);
    await handle(job.payload);
  }
}

const notifications = () =>
  [...jobs.jobs.values()]
    .filter((job) => job.type === "notification")
    .map((job) => {
      const payload = job.payload as {
        to: { channelId?: string; ntfy?: { topic: string } };
        notification: { kind: string };
      };
      return `${payload.notification.kind} ${payload.to.ntfy?.topic ?? payload.to.channelId}`;
    });

describe("setting up ntfy (decision D33)", () => {
  it("makes a secret topic and posts only the confirmation link until it is used", async () => {
    const { request, responseId } = await responder("Ben");
    expect(await ntfySetting(deps, request)).toEqual({
      kind: "setting",
      state: "off",
      server: SERVER,
    });
    expect(await requestNtfy(deps, request)).toEqual({ kind: "sent" });
    const channel = await channels.ntfyFor({ responseId });
    // FakeTokenService makes the topic: random in production (43 base64url characters).
    expect(channel?.topic).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await ntfySetting(deps, request)).toEqual({
      kind: "setting",
      state: "pending",
      server: SERVER,
      topic: channel?.topic,
    });
    await runConfirmations();
    expect(outbox.sent).toEqual([`confirm ${channel?.topic} plan fr`]);

    await notifyResponders(deps, (await repos.plans.findById(planId))!, "changed");
    expect(notifications()).toEqual([]);

    const token = links.tokenFor(channel?.id ?? "");
    expect(await openChannelLink(deps, token)).toEqual({
      kind: "confirm",
      channel: "ntfy",
      subject: { kind: "plan", planTitle: sampleInput.title },
      address: undefined,
    });
    expect(await useChannelLink(deps, { token, action: "confirm" })).toEqual({
      kind: "confirmed",
      channel: "ntfy",
    });
    await notifyResponders(deps, (await repos.plans.findById(planId))!, "changed");
    expect(notifications()).toEqual([`changed ${channel?.id}`]);
  });

  it("posts the same link again while waiting, keeps the topic, and changes nothing once on", async () => {
    const { request, responseId } = await responder("Ben");
    await requestNtfy(deps, request);
    const first = await channels.ntfyFor({ responseId });
    await requestNtfy(deps, request);
    expect((await channels.ntfyFor({ responseId }))?.id).toBe(first?.id);
    await runConfirmations();
    expect(outbox.sent).toHaveLength(2);
    await channels.confirm(first?.id ?? "");
    expect(await requestNtfy(deps, request)).toEqual({ kind: "unchanged" });
  });

  it("is turned off from the page, and only that for removed people (spec 3.5)", async () => {
    const { request, responseId } = await responder("Ben");
    await requestNtfy(deps, request);
    await removePerson(deps, { planId, deviceToken: host, responseId });
    expect(await requestNtfy(deps, request)).toEqual({ kind: "forbidden" });
    await runConfirmations();
    expect(outbox.sent).toEqual([]);
    expect(await turnOffNtfy(deps, request)).toEqual({ kind: "off" });
    expect(await channels.ntfyFor({ responseId })).toBeUndefined();
  });

  it("does not count against the five browsers, and goes with the plan's deletion notices", async () => {
    const { request, responseId } = await responder("Ben");
    await requestNtfy(deps, request);
    const id = (await channels.ntfyFor({ responseId }))?.id ?? "";
    await channels.confirm(id);
    for (const name of ["a", "b", "c", "d", "e", "f"]) {
      await subscribe(deps, {
        ...request,
        subscription: {
          endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
          keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
        },
      });
    }
    expect(await channels.ntfyFor({ responseId })).toBeDefined();
    jobs.jobs.clear();
    const send = await deletionNotices(deps, (await repos.plans.findById(planId))!);
    await send();
    const topic = (await channels.ntfyFor({ responseId }))?.topic;
    expect(notifications()).toContain(`deleted ${topic}`);
    // The job runner takes it and hands it to the notifier, the channel gone with the plan.
    const notifier = new FakeNotifier();
    const handle = notificationHandler({ notifier });
    const outcomes = [];
    for (const job of jobs.jobs.values()) outcomes.push(await handle(job.payload));
    expect(outcomes.every((outcome) => outcome === "done")).toBe(true);
    expect(notifier.sent.map(({ to }) => to)).toContainEqual({
      ntfy: { topic, server: SERVER.href },
    });
  });
});

describe("a change of NTFY_URL (decision D33)", () => {
  it("leaves topics on the old server off, removable, and replaced on a new setup", async () => {
    const { request, responseId } = await responder("Ben");
    await requestNtfy(deps, request);
    const old = await channels.ntfyFor({ responseId });
    await channels.confirm(old?.id ?? "");
    const moved = new URL("https://push.example.org/");
    deps = {
      ...deps,
      notify: deps.notify && { ...deps.notify, ntfy: { outbox, server: moved } },
    };
    // People subscribed on the old server: shown as on, but only turning off is offered.
    expect(await ntfySetting(deps, request)).toMatchObject({ state: "on", server: undefined });
    jobs.jobs.clear();
    await notifyResponders(deps, (await repos.plans.findById(planId))!, "changed");
    expect(notifications()).toEqual([]);
    expect((await openChannelLink(deps, links.tokenFor(old?.id ?? ""))).kind).toBe("turnOff");
    // Setting up again makes a new topic on the new server.
    expect(await requestNtfy(deps, request)).toEqual({ kind: "sent" });
    const fresh = await channels.ntfyFor({ responseId });
    expect(fresh?.id).not.toBe(old?.id);
    expect(fresh?.server).toBe(moved.href);
  });
});

describe("without NTFY_URL (decision D33)", () => {
  it("offers nothing, keeps stored topics removable, and sends nothing to them", async () => {
    const { request, responseId } = await responder("Ben");
    await requestNtfy(deps, request);
    const id = (await channels.ntfyFor({ responseId }))?.id ?? "";
    await channels.confirm(id);
    deps = { ...deps, notify: deps.notify && { ...deps.notify, ntfy: undefined } };
    expect(await ntfySetting(deps, request)).toMatchObject({ state: "on", server: undefined });
    expect(await requestNtfy(deps, request)).toEqual({ kind: "unavailable" });
    jobs.jobs.clear();
    await notifyResponders(deps, (await repos.plans.findById(planId))!, "changed");
    expect(notifications()).toEqual([]);
    expect((await openChannelLink(deps, links.tokenFor(id))).kind).toBe("turnOff");
    await turnOffNtfy(deps, request);
    expect(await ntfySetting(deps, request)).toEqual({ kind: "unavailable" });
  });
});
