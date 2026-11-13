// Fediverse direct messages for an account's notices (spec 7 Optional notification channels,
// decisions D44, D45, D47): who may switch them on, what is stored (only the choice), the first
// message and the expiry warning, the lookups that fail for a moment or for good, and what never
// goes there (plan notices).
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createFediverseDirectMessages } from "../../src/adapters/out/federation/direct-message.ts";
import { translator } from "../../src/adapters/i18n/i18n.ts";
import { deleteAccount, warnExpiringAccounts } from "../../src/application/account-data.ts";
import { type AccountDeps, finishLogin, startLogin } from "../../src/application/accounts.ts";
import { canReach } from "../../src/application/channel-kinds.ts";
import {
  accountNoticeHandler,
  channelConfirmationHandler,
  openChannelLink,
  useChannelLink,
} from "../../src/application/channel-links.ts";
import {
  fediverseMessagesSetting,
  turnOffFediverseMessages,
  turnOnFediverseMessages,
} from "../../src/application/fediverse-messages.ts";
import { runDueJobs } from "../../src/application/jobs.ts";
import { hostOf, notifyHost } from "../../src/application/notify.ts";
import { createPlan } from "../../src/application/plans.ts";
import type {
  ProviderAccount,
  RemoteActor,
  RemoteActorLookup,
} from "../../src/application/ports.ts";
import { FakeChannelLinks } from "../fakes/channel-links.ts";
import { FakeChannelRepository } from "../fakes/channels.ts";
import { FakeClock } from "../fakes/clock.ts";
import { FakePublisher } from "../fakes/fediverse-profiles.ts";
import { FakeIdentityProvider } from "../fakes/identity-provider.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { FakeJobQueue } from "../fakes/job-queue.ts";
import { FakeOutbox } from "../fakes/outbox.ts";
import { FakeSentReminders } from "../fakes/reminders.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const HANDLE = "@anna@social.example";
const ACTOR: RemoteActor = {
  id: "https://social.example/users/anna",
  inbox: "https://social.example/users/anna/inbox",
  sharedInbox: undefined,
};
const anna: ProviderAccount = {
  subject: "social.example 109",
  handle: HANDLE,
  names: ["Anna"],
};

type Answer = Awaited<ReturnType<RemoteActorLookup["resolve"]>>;

/** Answers with what the test says, and remembers every handle it was asked about. */
class FakeLookup implements RemoteActorLookup {
  answer: Answer = { kind: "found", actor: ACTOR };
  readonly asked: string[] = [];
  /** Holds the next lookup until it is released: the account changes while a message is made. */
  gate: Promise<void> | undefined;
  async resolve(handle: string) {
    this.asked.push(handle);
    const held = this.gate;
    this.gate = undefined;
    await held;
    return this.answer;
  }
}

let deps: AccountDeps;
let provider: FakeIdentityProvider;
let channels: FakeChannelRepository;
let jobs: FakeJobQueue;
let lookup: FakeLookup;
let publisher: FakePublisher;
let clock: FakeClock;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;

function notifyDeps(
  withMessages: boolean,
  repositories: ReturnType<typeof createFakeRepositories>,
) {
  return {
    channels,
    jobs,
    reminders: new FakeSentReminders(),
    links: new FakeChannelLinks(),
    ...(withMessages
      ? {
          fediverseMessages: {
            lookup,
            outbox: createFediverseDirectMessages({
              lookup,
              publisher,
              identities: repositories.identities,
              channels,
              instanceName: "Runs Munich",
              baseUrl: new URL("https://runs.example.org"),
              timeZone: "Europe/Berlin",
            }),
          },
        }
      : {}),
  };
}

beforeEach(() => {
  provider = new FakeIdentityProvider();
  channels = new FakeChannelRepository();
  jobs = new FakeJobQueue();
  lookup = new FakeLookup();
  publisher = new FakePublisher();
  clock = new FakeClock(fixtureNow);
  const repositories = createFakeRepositories();
  deps = {
    ...repositories,
    routeParser: new FakeRouteParser(),
    tokens: new FakeTokenService(),
    ids: new SequentialIdGenerator(),
    clock,
    limits: { horizonDays: 180, maxRetentionDays: 30 },
    postingMode: "anyone",
    identityLookup: { hash: (value) => `hmac(${value})` },
    identityProviders: { oidc: provider, fediverse: provider },
    fediverse: { servers: undefined, allowInsecure: false },
    notify: notifyDeps(true, repositories),
  };
});

/** Logs a new device in through a provider; returns its token. */
async function logIn(kind: "fediverse" | "oidc" = "fediverse", account = anna): Promise<string> {
  const started = await startLogin(deps, {
    provider: kind,
    ...(kind === "fediverse" ? { server: "social.example" } : {}),
  });
  if (started.kind !== "redirect") throw new Error("not started");
  const done = await finishLogin(deps, {
    provider: kind,
    callback: provider.approve(started.authorizationUrl, account),
    cookieState: started.state,
    deviceToken: undefined,
  });
  if (done.kind !== "logged_in") throw new Error("login");
  return done.newDeviceToken;
}

const identityIdOf = (): string => {
  const [identity] = (
    deps as unknown as { identities: { all(): { id: string }[] } }
  ).identities.all();
  return identity?.id ?? "";
};

const handlers = () => ({
  channelConfirmation: channelConfirmationHandler(deps),
  accountNotice: accountNoticeHandler(deps),
});
const runJobs = () => runDueJobs({ jobs, clock }, handlers());
const turnOn = (device: string, language = "de") =>
  turnOnFediverseMessages(deps, { deviceToken: device, language });
const notices = () => publisher.sent.filter((sent) => sent.kind === "accountNotice");

describe("canReach for a fediverse direct message (decision D47)", () => {
  it("depends on federation being on", () => {
    expect(canReach(deps.notify, { kind: "fediverse_dm" })).toBe(true);
    const off = notifyDeps(false, createFakeRepositories());
    expect(canReach(off, { kind: "fediverse_dm" })).toBe(false);
    expect(canReach(undefined, { kind: "fediverse_dm" })).toBe(false);
  });
});

describe("who may switch it on", () => {
  it("is offered to an account with a fediverse login while federation is on, and to no one else", async () => {
    const unavailable = { kind: "unavailable" };
    expect(await fediverseMessagesSetting(deps, { deviceToken: undefined })).toEqual(unavailable);
    const fediverse = await logIn("fediverse");
    expect(await fediverseMessagesSetting(deps, { deviceToken: fediverse })).toEqual({
      kind: "setting",
      state: "off",
    });
    const other = await logIn("oidc", { subject: "https://id.example bob", names: ["Bob"] });
    expect(await fediverseMessagesSetting(deps, { deviceToken: other })).toEqual(unavailable);
    expect(await turnOn(other)).toEqual(unavailable);
    expect(lookup.asked).toEqual([]);
    deps = { ...deps, notify: notifyDeps(false, createFakeRepositories()) };
    expect(await fediverseMessagesSetting(deps, { deviceToken: fediverse })).toEqual(unavailable);
    expect(await turnOn(fediverse)).toEqual(unavailable);
  });

  it("is not offered to a fediverse login without a handle on record", async () => {
    const device = await logIn("fediverse", { subject: "social.example 7", names: ["Zed"] });
    expect(await fediverseMessagesSetting(deps, { deviceToken: device })).toEqual({
      kind: "unavailable",
    });
  });
});

describe("switching on", () => {
  it("looks the account's own handle up, stores only the choice, and queues the first message", async () => {
    const device = await logIn();
    expect(await turnOn(device)).toEqual({ kind: "on" });
    expect(lookup.asked).toEqual([HANDLE]);
    expect([...channels.channels.values()]).toEqual([
      {
        id: expect.any(String),
        kind: "fediverse_dm",
        owner: { identityId: identityIdOf() },
        verified: true,
        language: "de",
      },
    ]);
    expect(await fediverseMessagesSetting(deps, { deviceToken: device })).toEqual({
      kind: "setting",
      state: "on",
    });
    const queued = [...jobs.jobs.values()];
    expect(queued.map((job) => job.type)).toEqual(["channelConfirmation"]);
    // Only the channel's id: nothing about the recipient is queued.
    expect(JSON.stringify(queued[0]?.payload)).not.toMatch(/social\.example|anna/);
    expect(notices()).toEqual([]);
  });

  it.each([
    ["is not found", { kind: "not_found" }],
    ["cannot be reached", { kind: "unavailable" }],
  ] as const)("stores nothing and queues nothing when the handle %s", async (_, answer) => {
    const device = await logIn();
    lookup.answer = answer;
    expect(await turnOn(device)).toEqual({ kind: "unresolved" });
    expect(channels.channels.size).toBe(0);
    expect(jobs.jobs.size).toBe(0);
    expect(await fediverseMessagesSetting(deps, { deviceToken: device })).toEqual({
      kind: "setting",
      state: "off",
    });
  });

  it("sends the first message once, from the instance, to the account's own inbox, in the channel's language", async () => {
    const device = await logIn();
    await turnOn(device, "de");
    await runJobs();
    const t = translator("de");
    expect(notices()).toEqual([
      {
        kind: "accountNotice",
        localActor: "instance",
        identityId: identityIdOf(),
        channelId: [...channels.channels.keys()][0],
        handle: HANDLE,
        to: ACTOR,
        text: [
          t("fediverseDm.first", { instance: "Runs Munich" }),
          t("fediverseDm.keeps"),
          t("fediverseDm.turnOff", { link: "https://runs.example.org/account" }),
        ].join("\n\n"),
      },
    ]);
    // Found when sent, again: once for the switch, once for the message.
    expect(lookup.asked).toEqual([HANDLE, HANDLE]);
    expect(jobs.jobs.size).toBe(0);
    // No plan, no date.
    expect(notices()[0]?.text).not.toMatch(/\/p\/|\d{4}/);
  });

  it("changes nothing and sends nothing when it is already on", async () => {
    const device = await logIn();
    await turnOn(device);
    await runJobs();
    lookup.asked.length = 0;
    expect(await turnOn(device)).toEqual({ kind: "unchanged" });
    expect(lookup.asked).toEqual([]);
    expect(jobs.jobs.size).toBe(0);
    expect(channels.channels.size).toBe(1);
  });

  it("is turned off without a message, whether or not federation is on", async () => {
    const device = await logIn();
    await turnOn(device);
    await runJobs();
    publisher.sent.length = 0;
    expect(await turnOffFediverseMessages(deps, { deviceToken: device })).toEqual({ kind: "off" });
    expect(channels.channels.size).toBe(0);
    expect(publisher.sent).toEqual([]);
    expect(await turnOffFediverseMessages(deps, { deviceToken: undefined })).toEqual({
      kind: "unavailable",
    });
    await turnOn(device);
    deps = { ...deps, notify: notifyDeps(false, createFakeRepositories()) };
    expect(await turnOffFediverseMessages(deps, { deviceToken: device })).toEqual({ kind: "off" });
  });

  it("has no link: nothing to confirm, refuse or open", async () => {
    const device = await logIn();
    await turnOn(device);
    const id = [...channels.channels.keys()][0] ?? "";
    const token = new FakeChannelLinks().tokenFor(id);
    expect(await openChannelLink(deps, token)).toEqual({ kind: "not_found" });
    expect(await useChannelLink(deps, { token, action: "off" })).toEqual({ kind: "not_found" });
    expect(channels.channels.size).toBe(1);
  });
});

describe("the first message when the lookup fails", () => {
  it("is tried again after a temporary failure, on the job schedule, and then sent once", async () => {
    const device = await logIn();
    await turnOn(device);
    lookup.answer = { kind: "unavailable" };
    expect(await runJobs()).toMatchObject({ retried: 1, done: 0 });
    expect(notices()).toEqual([]);
    expect([...jobs.jobs.values()].map((job) => job.attempts)).toEqual([1]);
    // Not yet due.
    expect(await runJobs()).toMatchObject({ retried: 0, done: 0 });
    lookup.answer = { kind: "found", actor: ACTOR };
    clock.set(new Date(clock.now().getTime() + 61_000).toISOString());
    expect(await runJobs()).toMatchObject({ done: 1 });
    expect(notices()).toHaveLength(1);
    expect(jobs.jobs.size).toBe(0);
  });

  it("is dropped after a final answer, and the channel stays for the person to switch off", async () => {
    const device = await logIn();
    await turnOn(device);
    lookup.answer = { kind: "not_found" };
    expect(await runJobs()).toMatchObject({ dropped: 1, retried: 0 });
    expect(notices()).toEqual([]);
    expect(jobs.jobs.size).toBe(0);
    expect(channels.channels.size).toBe(1);
  });

  it("deletes the channel when the account is gone, as for any channel", async () => {
    const device = await logIn();
    await turnOn(device);
    await deps.identities.delete(identityIdOf());
    expect(await runJobs()).toMatchObject({ dropped: 1 });
    expect(notices()).toEqual([]);
    expect(channels.channels.size).toBe(0);
  });
});

describe("the expiry warning (spec 3.10, decision I52)", () => {
  /** Hosts a plan with a title and place, so the warning could carry them if it wanted. */
  async function hostPlan(device: string) {
    const created = await createPlan(deps, {
      input: { ...sampleInput, title: "Secret Hill Repeats 9931" },
      units: "metric",
      language: "en",
      creationNonce: nonce(),
      deviceToken: device,
    });
    if (created.kind !== "created") throw new Error("plan");
    return created.planId;
  }

  it("reaches the channel with the date and the instance's name, once per stretch, in its language", async () => {
    const device = await logIn();
    await hostPlan(device);
    await turnOn(device, "fr");
    await runJobs();
    publisher.sent.length = 0;
    const lastActive = clock.now();
    clock.set(new Date(lastActive.getTime() + 352 * DAY_MS).toISOString());
    expect(await warnExpiringAccounts(deps)).toBe(1);
    expect(await warnExpiringAccounts(deps)).toBe(0);
    await runJobs();
    const t = translator("fr");
    const date = new Intl.DateTimeFormat("fr", {
      timeZone: "Europe/Berlin",
      dateStyle: "long",
    }).format(new Date(lastActive.getTime() + 365 * DAY_MS));
    const [sent, ...rest] = notices();
    expect(rest).toEqual([]);
    expect(sent?.text).toBe(
      [
        t("notice.expirySubject", { instance: "Runs Munich", date }),
        t("notice.expiryBody", { date }),
        t("fediverseDm.turnOff", { link: "https://runs.example.org/account" }),
      ].join("\n\n"),
    );
    expect(sent?.to).toEqual(ACTOR);
    // By construction nothing of a plan is in it.
    expect(sent?.text).not.toMatch(/Secret|Hill|Flaucher|\/p\//);
  });

  it("is not queued while federation is off, and not for an account that did not switch it on", async () => {
    const device = await logIn();
    await turnOn(device);
    clock.set(new Date(fixtureNow.getTime() + 352 * DAY_MS).toISOString());
    deps = { ...deps, notify: notifyDeps(false, createFakeRepositories()) };
    jobs.jobs.clear();
    expect(await warnExpiringAccounts(deps)).toBe(0);
    expect([...jobs.jobs.values()]).toEqual([]);
    deps = { ...deps, notify: notifyDeps(true, createFakeRepositories()) };
    channels.channels.clear();
    expect(await warnExpiringAccounts(deps)).toBe(0);
  });

  it("is tried again after a temporary failure and then sent once", async () => {
    const device = await logIn();
    await turnOn(device);
    await runJobs();
    publisher.sent.length = 0;
    clock.set(new Date(fixtureNow.getTime() + 352 * DAY_MS).toISOString());
    await warnExpiringAccounts(deps);
    lookup.answer = { kind: "unavailable" };
    expect(await runJobs()).toMatchObject({ retried: 1 });
    lookup.answer = { kind: "found", actor: ACTOR };
    clock.set(new Date(clock.now().getTime() + 61_000).toISOString());
    expect(await runJobs()).toMatchObject({ done: 1 });
    expect(notices()).toHaveLength(1);
  });

  it("is dropped after a final answer and keeps the channel", async () => {
    const device = await logIn();
    await turnOn(device);
    await runJobs();
    clock.set(new Date(fixtureNow.getTime() + 352 * DAY_MS).toISOString());
    await warnExpiringAccounts(deps);
    lookup.answer = { kind: "not_found" };
    expect(await runJobs()).toMatchObject({ dropped: 1, retried: 0 });
    expect(channels.channels.size).toBe(1);
    expect(jobs.jobs.size).toBe(0);
  });
});

describe("plan notices (decision D47)", () => {
  it("never go to an account's fediverse channel, though the account hosts the plan", async () => {
    const device = await logIn();
    await turnOn(device);
    await runJobs();
    const created = await createPlan(deps, {
      input: sampleInput,
      units: "metric",
      language: "en",
      creationNonce: nonce(),
      deviceToken: device,
    });
    if (created.kind !== "created") throw new Error("plan");
    const plan = await deps.plans.findById(created.planId);
    if (plan === undefined) throw new Error("plan");
    // The plan's own channel gets it; the account's does not.
    const emailId = await channels.setEmail({ planId: plan.id }, "host@example.org", "en");
    await channels.confirm(emailId);
    jobs.jobs.clear();
    deps = {
      ...deps,
      notify: deps.notify && {
        ...deps.notify,
        email: { outbox: new FakeOutbox(), reportAlerts: false },
      },
    };
    expect(await notifyHost(deps, plan, "cancelled")).toBe(1);
    expect([...jobs.jobs.values()].map((job) => [job.type, job.payload])).toEqual([
      ["notification", expect.objectContaining({ to: { channelId: emailId } })],
    ]);
    expect(hostOf(plan).owner).toEqual({ planId: plan.id });
  });
});

describe("deleting the account (spec 3.7)", () => {
  it("removes the channel and the messages waiting for it, and nothing else queued", async () => {
    const device = await logIn();
    await turnOn(device);
    await jobs.enqueue({
      type: "federationDelivery",
      payload: { inbox: "https://social.example/users/anna/inbox", forAccount: identityIdOf() },
      runAt: clock.now(),
    });
    await jobs.enqueue({
      type: "federationDelivery",
      payload: { inbox: "https://other.example/inbox", forAccount: "someone-else" },
      runAt: clock.now(),
    });
    await jobs.enqueue({
      type: "federationDelivery",
      payload: { inbox: "https://follower.example/inbox" },
      runAt: clock.now(),
    });
    await jobs.enqueue({
      type: "accountNotice",
      payload: { channelId: "another-channel", notice: "expiry", lastActiveAt: "2026-01-01" },
      runAt: clock.now(),
    });
    expect(await deleteAccount(deps, { deviceToken: device })).toEqual({ kind: "deleted" });
    expect([...jobs.jobs.values()].map((job) => [job.type, JSON.stringify(job.payload)])).toEqual([
      ["federationDelivery", expect.stringContaining("other.example")],
      ["federationDelivery", expect.stringContaining("follower.example")],
      ["accountNotice", expect.stringContaining("another-channel")],
    ]);
  });
});

describe("a message in flight while the account changes (decision D47)", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  /** Starts the queued jobs with the next lookup held; returns the way to let it go on. */
  async function inFlight() {
    let release = () => {};
    lookup.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = runJobs();
    await settle();
    return async () => {
      release();
      await running;
    };
  }

  it("is not queued when the account is deleted during the lookup", async () => {
    const device = await logIn();
    await turnOn(device);
    const finish = await inFlight();
    await deleteAccount(deps, { deviceToken: device });
    await finish();
    expect(notices()).toEqual([]);
  });

  it("is not queued when the channel is switched off during the lookup", async () => {
    const device = await logIn();
    await turnOn(device);
    const finish = await inFlight();
    await turnOffFediverseMessages(deps, { deviceToken: device });
    await finish();
    expect(notices()).toEqual([]);
  });

  it("is not queued for a channel that was switched off and on again: only the new first message goes", async () => {
    const device = await logIn();
    await turnOn(device);
    const finish = await inFlight();
    await turnOffFediverseMessages(deps, { deviceToken: device });
    await turnOn(device);
    await finish();
    expect(notices()).toEqual([]);
    await runJobs();
    expect(notices()).toHaveLength(1);
  });
});

describe("removing an account's queued messages", () => {
  it("runs after the account is deleted, so nothing queued in between slips through", async () => {
    const device = await logIn();
    await turnOn(device);
    const log: string[] = [];
    const remove = deps.identities.delete.bind(deps.identities);
    deps.identities.delete = async (id) => {
      log.push("delete account");
      await remove(id);
    };
    const scan = jobs.deleteWhere.bind(jobs);
    jobs.deleteWhere = (type, matches) => {
      log.push(`remove ${type}`);
      return scan(type, matches);
    };
    await deleteAccount(deps, { deviceToken: device });
    expect(log[0]).toBe("delete account");
    expect(log).toContain("remove federationDelivery");
  });

  it("does not look through the delivery queue for an account without a fediverse login", async () => {
    const device = await logIn("oidc", { subject: "https://id.example bob", names: ["Bob"] });
    const scanned: string[] = [];
    const scan = jobs.deleteWhere.bind(jobs);
    jobs.deleteWhere = (type, matches) => {
      scanned.push(type);
      return scan(type, matches);
    };
    await deleteAccount(deps, { deviceToken: device });
    expect(scanned).toEqual([]);
  });
});

describe("two switch-ons at once", () => {
  it("count as one switch-on that looked something up: the late one says on, not unchanged", async () => {
    const device = await logIn();
    const owner = { identityId: identityIdOf() };
    await channels.setFediverseDm(owner, "de");
    // The late request read the channel before the early one stored it.
    const real = channels.fediverseDmFor.bind(channels);
    channels.fediverseDmFor = () => {
      channels.fediverseDmFor = real;
      return Promise.resolve(undefined);
    };
    expect(await turnOn(device)).toEqual({ kind: "on" });
    expect(jobs.jobs.size).toBe(0);
  });
});

describe("the switch while federation is off", () => {
  it("is offered only to turn off an account's channel that is on", async () => {
    const device = await logIn();
    await turnOn(device);
    deps = { ...deps, notify: notifyDeps(false, createFakeRepositories()) };
    expect(await fediverseMessagesSetting(deps, { deviceToken: device })).toEqual({
      kind: "setting",
      state: "on",
      paused: true,
    });
    await turnOffFediverseMessages(deps, { deviceToken: device });
    expect(await fediverseMessagesSetting(deps, { deviceToken: device })).toEqual({
      kind: "unavailable",
    });
    const other = await logIn("oidc", { subject: "https://id.example bob", names: ["Bob"] });
    expect(await fediverseMessagesSetting(deps, { deviceToken: other })).toEqual({
      kind: "unavailable",
    });
  });
});
