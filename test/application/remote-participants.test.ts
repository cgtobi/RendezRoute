// Remote participants (spec 7 ActivityPub, 3.7; decision D42; 0.9 step 11a): a remote actor's Join
// or TentativeAccept becomes a response, answered with Accept or Reject, decided by the host in
// approval mode; a plan's Update and Delete reach these people whatever its visibility, from the
// plan's attributed actor, and narrowing a plan does not take it from them.
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { subscribe } from "../../src/application/channels.ts";
import { deleteAccount } from "../../src/application/account-data.ts";
import { deletePlanAsAdmin } from "../../src/application/admin.ts";
import { type AccountDeps, finishLogin, startLogin } from "../../src/application/accounts.ts";
import { createProfile } from "../../src/application/fediverse-profile.ts";
import { followActor, INSTANCE_ACTOR } from "../../src/application/following.ts";
import {
  acceptRequest,
  cancelPlan,
  deletePlan,
  editPlan,
  rejectRequest,
  removePerson,
  restorePerson,
} from "../../src/application/host.ts";
import { applyRetentionMax, runRetentionSweep } from "../../src/application/maintenance.ts";
import { deleteMyData } from "../../src/application/my-data.ts";
import { createPlan } from "../../src/application/plans.ts";
import type { ProviderAccount, RemoteActor } from "../../src/application/ports.ts";
import {
  forgetRemoteParticipant,
  joinRemote,
  leaveRemote,
} from "../../src/application/remote-participants.ts";
import { planToInput } from "../../src/domain/plan-edit.ts";
import type { PlanInput } from "../../src/domain/plan-input.ts";
import { FakeAdminAuth } from "../fakes/admin-auth.ts";
import { FakeChannelRepository } from "../fakes/channels.ts";
import { FakeClock } from "../fakes/clock.ts";
import {
  FakeActorKeys,
  FakeFediverseProfiles,
  FakeFollowers,
  FakeContributionNotes,
  FakeParticipantNotes,
  FakeRemoteContributions,
  FakePublications,
  FakePublisher,
} from "../fakes/fediverse-profiles.ts";
import { FakeIdentityProvider } from "../fakes/identity-provider.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeJobQueue } from "../fakes/job-queue.ts";
import { FakeSentReminders } from "../fakes/reminders.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

/** When the sample plan starts: 2026-06-07 07:30 in Berlin. */
const sampleStart = new Date("2026-06-07T05:30:00Z");

let deps: AccountDeps;
let provider: FakeIdentityProvider;
let profiles: FakeFediverseProfiles;
let followers: FakeFollowers;
let publisher: FakePublisher;
let clock: FakeClock;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;

beforeEach(() => {
  provider = new FakeIdentityProvider();
  followers = new FakeFollowers();
  profiles = new FakeFediverseProfiles(followers);
  publisher = new FakePublisher();
  clock = new FakeClock(fixtureNow);
  deps = {
    ...createFakeRepositories(),
    routeParser: new FakeRouteParser(),
    tokens: new FakeTokenService(),
    ids: new SequentialIdGenerator(),
    clock,
    limits: { horizonDays: 180, maxRetentionDays: 30 },
    postingMode: "anyone",
    publicRequiresLogin: true,
    posterActors: {
      profiles,
      actorKeys: new FakeActorKeys(),
      followers,
      publications: new FakePublications(),
      notes: new FakeParticipantNotes(),
      contributionNotes: new FakeContributionNotes(),
      remoteContributions: new FakeRemoteContributions(),
      publisher,
      enabled: true,
    },
    identityLookup: { hash: (value) => `hmac(${value})` },
    identityProviders: { oidc: provider },
    fediverse: { servers: undefined, allowInsecure: false },
  };
});

async function logIn(): Promise<string> {
  const account: ProviderAccount = { subject: "https://id.example.org anna", names: ["Anna"] };
  const started = await startLogin(deps, { provider: "oidc" });
  if (started.kind !== "redirect") throw new Error("not started");
  const done = await finishLogin(deps, {
    provider: "oidc",
    callback: provider.approve(started.authorizationUrl, account),
    cookieState: started.state,
    deviceToken: undefined,
  });
  if (done.kind !== "logged_in" || done.newDeviceToken === undefined) throw new Error("login");
  return done.newDeviceToken;
}

async function plan(deviceToken: string, input: Partial<PlanInput> = {}) {
  const result = await createPlan(deps, {
    input: { ...sampleInput, ...input },
    units: "metric",
    language: "en",
    creationNonce: nonce(),
    deviceToken,
  });
  if (result.kind !== "created") throw new Error(`create failed: ${JSON.stringify(result)}`);
  return result.planId;
}

const stored = async (planId: string) => {
  const found = await deps.plans.findById(planId);
  if (found === undefined) throw new Error("no plan");
  return found;
};

const edit = async (deviceToken: string, planId: string, input: Partial<PlanInput>) =>
  editPlan(deps, {
    planId,
    deviceToken,
    input: { ...planToInput(await stored(planId), "metric"), ...input },
    units: "metric",
    confirmDeleteNow: false,
  });

const later = (minutes: number) =>
  clock.set(new Date(clock.now().getTime() + minutes * 60_000).toISOString());

const remote = (name: string, server = "social.example"): RemoteActor => ({
  id: `https://${server}/users/${name}`,
  inbox: `https://${server}/users/${name}/inbox`,
  sharedInbox: `https://${server}/inbox`,
});

const join = (
  planId: string,
  actor: RemoteActor,
  kind: "join" | "tentative" = "join",
  options: {
    username?: string | undefined;
    name?: string | undefined;
    /** Asked only when a notice is due, with the kind of response. */
    mayNotifyHost?: (kind: string) => boolean;
    /** Which activity of the actor, for the identifier. */
    n?: number;
  } = {},
) =>
  joinRemote(deps, {
    planId,
    join: { id: `${actor.id}#${kind}-${options.n ?? 1}`, kind },
    actor,
    username: "username" in options ? options.username : actor.id.split("/").at(-1),
    name: options.name,
    mayNotifyHost: options.mayNotifyHost ?? (() => true),
  });

/** The answers sent, as "accept ben" or "reject ben" (the actor's last name part). */
const answers = () =>
  sentActivities().flatMap((sent) =>
    sent.kind === "answer" ? [`${sent.answer} ${sent.to.split("/").at(-1)}`] : [],
  );

const responsesOf = async (planId: string) =>
  (await deps.responses.listRemote(planId)).map((entry) => [
    entry.actor.id.split("/").at(-1),
    entry.response.kind,
  ]);

/** What was sent, but for the private Notes, which have their own tests (decision D43). */
const sentActivities = () =>
  publisher.sent.filter((sent) => sent.kind !== "note" && sent.kind !== "noteDelete");

const withFederation = (enabled: boolean) => {
  deps = { ...deps, posterActors: { ...deps.posterActors!, enabled } };
};

describe("a remote Join or TentativeAccept (decision D42)", () => {
  it("joins a link-only plan, answered with Accept from the instance actor wrapping the Join", async () => {
    const device = await logIn();
    const planId = await plan(device, { visibility: "link" });
    expect(await join(planId, remote("ben"))).toBe("stored");
    const [response] = await deps.responses.listByPlan(planId);
    expect(response).toMatchObject({ kind: "joined", displayName: "ben@social.example" });
    expect(sentActivities()).toEqual([
      {
        kind: "answer",
        answer: "accept",
        localActor: INSTANCE_ACTOR,
        planId,
        responseId: response?.id,
        to: "https://social.example/users/ben",
        join: { id: "https://social.example/users/ben#join-1", kind: "join" },
        language: "en",
      },
    ]);
    expect(await deps.responses.counts(planId)).toEqual({ interested: 0, participants: 1 });
  });

  it("is answered by the poster's actor on a plan its profile shares", async () => {
    const device = await logIn();
    await createProfile(deps, { deviceToken: device, handle: "anna" });
    const actor = (await profiles.findByHandle("anna"))?.id ?? "";
    const planId = await plan(device, { visibility: "followers" });
    await join(planId, remote("cleo", "other.example"));
    expect(sentActivities().at(-1)).toMatchObject({ kind: "answer", answer: "accept" });
    expect(sentActivities().at(-1)).toMatchObject({ localActor: actor });
  });

  it("takes a TentativeAccept as interested, and a changed mind as a change", async () => {
    const device = await logIn();
    const planId = await plan(device, { joinMode: "approval" });
    await join(planId, remote("dora"), "tentative");
    expect(await responsesOf(planId)).toEqual([["dora", "interested"]]);
    expect(sentActivities().at(-1)).toMatchObject({
      answer: "accept",
      join: { id: "https://social.example/users/dora#tentative-1", kind: "tentative" },
    });
    // Joining after interest, in approval mode: a request, not yet answered.
    await join(planId, remote("dora"), "join");
    expect(await responsesOf(planId)).toEqual([["dora", "requested"]]);
    expect(answers()).toEqual(["accept dora"]);
    await join(planId, remote("dora"), "tentative");
    expect(await responsesOf(planId)).toEqual([["dora", "interested"]]);
  });

  it("makes a request in approval mode, answered only when the host decides", async () => {
    const device = await logIn();
    const planId = await plan(device, { joinMode: "approval" });
    await join(planId, remote("eli"));
    await join(planId, remote("fay"));
    await join(planId, remote("gus"));
    await join(planId, remote("hal"));
    expect(await responsesOf(planId)).toEqual([
      ["eli", "requested"],
      ["fay", "requested"],
      ["gus", "requested"],
      ["hal", "requested"],
    ]);
    expect(sentActivities()).toEqual([]);
    const idOf = async (name: string) =>
      (await deps.responses.listByPlan(planId)).find((r) => r.displayName.startsWith(`${name}@`))
        ?.id ?? "";
    const act = async (
      action:
        | typeof acceptRequest
        | typeof rejectRequest
        | typeof removePerson
        | typeof restorePerson,
      name: string,
    ) => action(deps, { planId, deviceToken: device, responseId: await idOf(name) });
    expect(await act(acceptRequest, "eli")).toEqual({ kind: "accepted" });
    expect(await act(rejectRequest, "fay")).toEqual({ kind: "rejected" });
    expect(answers()).toEqual(["accept eli", "reject fay"]);
    expect(sentActivities().at(-1)).toMatchObject({
      responseId: await idOf("fay"),
      join: { id: "https://social.example/users/fay#join-1" },
    });
    // Removing an accepted participant, and restoring them, tell them as well.
    expect(await act(removePerson, "eli")).toEqual({ kind: "removed" });
    expect(await act(restorePerson, "eli")).toEqual({ kind: "restored" });
    expect(answers()).toEqual(["accept eli", "reject fay", "reject eli"]);
    // Restored in approval mode: a pending request again, nothing sent.
    expect(await responsesOf(planId)).toContainEqual(["eli", "requested"]);
    // Switching to open mode accepts the pending ones and tells them.
    expect(
      await editPlan(deps, {
        planId,
        deviceToken: device,
        input: { ...planToInput(await stored(planId), "metric"), joinMode: "open" },
        units: "metric",
        confirmDeleteNow: false,
        confirmAcceptPending: 3,
      }),
    ).toMatchObject({ kind: "updated" });
    expect(answers().slice(3).sort()).toEqual(["accept eli", "accept gus", "accept hal"]);
  });

  it("rejects a Join of a cancelled or started plan, stores nothing, and ignores an unknown plan", async () => {
    const device = await logIn();
    const cancelled = await plan(device, { title: "Cancelled run" });
    await cancelPlan(deps, { planId: cancelled, deviceToken: device });
    const started = await plan(device, { title: "Started run" });
    expect(await join(cancelled, remote("ivy"))).toBe("rejected");
    expect(await join(cancelled, remote("jon"), "tentative")).toBe("rejected");
    clock.set(new Date(sampleStart.getTime() + 60_000).toISOString());
    expect(await join(started, remote("kim"))).toBe("rejected");
    expect(answers()).toEqual(["reject ivy", "reject jon", "reject kim"]);
    expect(sentActivities().map((sent) => sent.kind === "answer" && sent.responseId)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(await deps.responses.listRemote(cancelled)).toEqual([]);
    expect(await deps.responses.listRemote(started)).toEqual([]);
    publisher.sent.length = 0;
    expect(await join("no-such-plan-0000000001", remote("lou"))).toBe("ignored");
    expect(sentActivities()).toEqual([]);
  });

  it("rejects an actor the host rejected or removed, and a Join whose inbox is on another server", async () => {
    const device = await logIn();
    const planId = await plan(device, { joinMode: "approval" });
    await join(planId, remote("mia"));
    const [mia] = await deps.responses.listByPlan(planId);
    await rejectRequest(deps, { planId, deviceToken: device, responseId: mia?.id ?? "" });
    publisher.sent.length = 0;
    expect(await join(planId, remote("mia"))).toBe("rejected");
    expect(answers()).toEqual(["reject mia"]);
    expect(await responsesOf(planId)).toEqual([["mia", "rejected"]]);
    // An Undo does not lift the block.
    expect(await leaveRemote(deps, { planId, actorId: remote("mia").id })).toBe(false);
    expect(await responsesOf(planId)).toEqual([["mia", "rejected"]]);

    publisher.sent.length = 0;
    const elsewhere = { ...remote("ned"), inbox: "https://victim.example/inbox" };
    expect(await join(planId, elsewhere)).toBe("ignored");
    expect(sentActivities()).toEqual([]);
  });

  it("is idempotent: the same Join twice is one response and one participant", async () => {
    const device = await logIn();
    const planId = await plan(device);
    await join(planId, remote("oda"));
    await join(planId, remote("oda"));
    expect(await responsesOf(planId)).toEqual([["oda", "joined"]]);
    expect(await deps.responses.counts(planId)).toEqual({ interested: 0, participants: 1 });
  });

  it("does nothing while federation is off", async () => {
    const device = await logIn();
    const planId = await plan(device);
    withFederation(false);
    expect(await join(planId, remote("pia"))).toBe("ignored");
    expect(await deps.responses.listRemote(planId)).toEqual([]);
    expect(sentActivities()).toEqual([]);
  });

  it("is named by its fediverse address, whatever the actor calls itself", async () => {
    const device = await logIn();
    const planId = await plan(device, { posterName: "Anna" });
    await join(planId, remote("tom"), "join", { name: "Thomas the Great" });
    // The poster's own name is taken: the next best is the actor's server.
    await join(planId, remote("qui"), "join", { username: "", name: "Anna" });
    await join(planId, remote("rex"), "join", { username: "", name: "   " });
    // Without a username, the name is used as it is.
    await join(planId, remote("sue"), "join", { username: undefined, name: "Sue Ray" });
    expect((await deps.responses.listByPlan(planId)).map((r) => r.displayName)).toEqual([
      "tom@social.example",
      "social.example",
      "social.example",
      "Sue Ray",
    ]);
  });

  it("cannot be disguised by invisible characters or an @ in the username", async () => {
    const device = await logIn();
    const planId = await plan(device);
    // A right-to-left override and a zero-width space are dropped; an @ or a space in a
    // username could pass for another address, so the name, or the server, is used instead.
    await join(planId, remote("u1"), "join", { username: "\u202Eev\u200Bil" });
    await join(planId, remote("u2"), "join", { username: "ceo@bank.example", name: "Real Name" });
    await join(planId, remote("u3"), "join", { username: "a b", name: "\u202E\u200B" });
    await join(planId, remote("u4"), "join", { username: "\u200B\u202E", name: "N\u200Bame" });
    expect((await deps.responses.listByPlan(planId)).map((r) => r.displayName)).toEqual([
      "evil@social.example",
      "Real Name",
      "social.example",
      "Name",
    ]);
  });
});

describe("limits and notices", () => {
  const subscribeHost = async (device: string, planId: string) =>
    subscribe(deps, {
      planId,
      deviceToken: device,
      role: "host",
      subscription: {
        endpoint: "https://fcm.googleapis.com/fcm/send/host",
        keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
      },
    });
  const notices = () =>
    [...jobs.jobs.values()].map(
      (job) => (job.payload as { notification: { kind: string } }).notification.kind,
    );
  let jobs: FakeJobQueue;
  beforeEach(() => {
    jobs = new FakeJobQueue();
    deps = {
      ...deps,
      notify: { channels: new FakeChannelRepository(), jobs, reminders: new FakeSentReminders() },
    };
  });

  it("tells the host of a new response, and of a change to joining or requesting, but not of interest", async () => {
    const device = await logIn();
    const planId = await plan(device, { joinMode: "approval" });
    await subscribeHost(device, planId);
    await join(planId, remote("ann"), "tentative");
    expect(notices()).toEqual(["newResponse"]);
    await join(planId, remote("ann"), "join", { n: 2 });
    expect(notices()).toEqual(["newResponse", "newRequest"]);
    // Back to interested: no news.
    await join(planId, remote("ann"), "tentative", { n: 3 });
    expect(notices()).toEqual(["newResponse", "newRequest"]);
  });

  it("tells the host nothing when the caller says the actor notified lately, and stores all the same", async () => {
    const device = await logIn();
    const planId = await plan(device);
    await subscribeHost(device, planId);
    await join(planId, remote("bob"), "join", { mayNotifyHost: () => false });
    await join(planId, remote("bob"), "tentative", { mayNotifyHost: () => false });
    await join(planId, remote("bob"), "join", { mayNotifyHost: () => false, n: 2 });
    expect(notices()).toEqual([]);
    expect(await responsesOf(planId)).toEqual([["bob", "joined"]]);
  });

  it("asks whether to notify only when a notice is due, naming the kind", async () => {
    const device = await logIn();
    const planId = await plan(device, { joinMode: "approval" });
    await subscribeHost(device, planId);
    const asked: string[] = [];
    const ask = (kind: string) => {
      asked.push(kind);
      return true;
    };
    await join(planId, remote("cy"), "tentative", { mayNotifyHost: ask });
    await join(planId, remote("cy"), "join", { mayNotifyHost: ask, n: 2 });
    // Back to interested, and a repeat of the same: nothing due, nobody asked.
    await join(planId, remote("cy"), "tentative", { mayNotifyHost: ask, n: 3 });
    await join(planId, remote("cy"), "tentative", { mayNotifyHost: ask, n: 3 });
    expect(asked).toEqual(["interested", "requested"]);
    expect(notices()).toEqual(["newResponse", "newRequest"]);
  });

  it("takes at most 50 responses to a plan from one server, and rejects the rest", async () => {
    const device = await logIn();
    const planId = await plan(device);
    for (let i = 0; i < 50; i++) await join(planId, remote(`u${i}`));
    expect(await join(planId, remote("late"))).toBe("rejected");
    expect(await deps.responses.listRemote(planId)).toHaveLength(50);
    expect(sentActivities().at(-1)).toMatchObject({
      answer: "reject",
      responseId: undefined,
      to: "https://social.example/users/late",
    });
    // Another server is unaffected, and so is another plan; a known actor can still change.
    expect(await join(planId, remote("other", "other.example"))).toBe("stored");
    expect(await join(await plan(device), remote("late"))).toBe("stored");
    expect(await join(planId, remote("u7"), "tentative")).toBe("stored");
  });
});

describe("restoring a remote person (host)", () => {
  it("answers Accept for a restored interested person, and none for a pending request", async () => {
    const device = await logIn();
    const planId = await plan(device, { joinMode: "approval" });
    await join(planId, remote("ola"), "tentative");
    await join(planId, remote("pat"));
    const idOf = async (name: string) =>
      (await deps.responses.listByPlan(planId)).find((r) => r.displayName.startsWith(`${name}@`))
        ?.id ?? "";
    const by = { planId, deviceToken: device };
    await removePerson(deps, { ...by, responseId: await idOf("ola") });
    await rejectRequest(deps, { ...by, responseId: await idOf("pat") });
    publisher.sent.length = 0;
    await restorePerson(deps, { ...by, responseId: await idOf("ola") });
    expect(answers()).toEqual(["accept ola"]);
    expect(await responsesOf(planId)).toContainEqual(["ola", "interested"]);
    await restorePerson(deps, { ...by, responseId: await idOf("pat") });
    expect(answers()).toEqual(["accept ola"]);
    expect(await responsesOf(planId)).toContainEqual(["pat", "requested"]);
  });
});

describe("a repeated Join", () => {
  it("is answered again, by a new activity of the same actor too", async () => {
    const device = await logIn();
    const planId = await plan(device);
    await join(planId, remote("qua"));
    await join(planId, remote("qua"), "join", { n: 2 });
    expect(answers()).toEqual(["accept qua", "accept qua"]);
    expect(sentActivities().at(-1)).toMatchObject({
      join: { id: "https://social.example/users/qua#join-2" },
    });
    expect(await responsesOf(planId)).toEqual([["qua", "joined"]]);
  });
});

describe("leaving and being deleted", () => {
  it("does not undo an answer the actor has replaced since", async () => {
    const device = await logIn();
    const planId = await plan(device);
    const actor = remote("rae");
    const joinId = `${actor.id}#join-1`;
    const tentativeId = `${actor.id}#tentative-1`;
    await join(planId, actor, "tentative");
    await join(planId, actor, "join");
    // An Undo of the TentativeAccept, late, does not take back the Join that followed it.
    expect(await leaveRemote(deps, { planId, actorId: actor.id, joinId: tentativeId })).toBe(false);
    expect(await responsesOf(planId)).toEqual([["rae", "joined"]]);
    await join(planId, actor, "tentative", { n: 2 });
    expect(await leaveRemote(deps, { planId, actorId: actor.id, joinId })).toBe(false);
    expect(await responsesOf(planId)).toEqual([["rae", "interested"]]);
    expect(
      await leaveRemote(deps, { planId, actorId: actor.id, joinId: `${actor.id}#tentative-2` }),
    ).toBe(true);
    expect(await responsesOf(planId)).toEqual([]);
  });

  it("removes the response on an Undo, and all of an actor's responses, in every plan, when it is deleted", async () => {
    const device = await logIn();
    const first = await plan(device, { title: "First" });
    const second = await plan(device, { title: "Second" });
    await join(first, remote("sam"));
    await join(second, remote("sam"));
    await join(second, remote("tia"));
    expect(await leaveRemote(deps, { planId: first, actorId: remote("sam").id })).toBe(true);
    expect(await responsesOf(first)).toEqual([]);
    expect(await leaveRemote(deps, { planId: first, actorId: remote("sam").id })).toBe(false);
    await join(first, remote("sam"));
    expect(await forgetRemoteParticipant(deps, remote("sam").id)).toBe(2);
    expect(await responsesOf(first)).toEqual([]);
    expect(await responsesOf(second)).toEqual([["tia", "joined"]]);
  });
});

describe("what reaches remote participants (decision D42)", () => {
  async function sharing() {
    const device = await logIn();
    await createProfile(deps, { deviceToken: device, handle: "anna" });
    const actor = (await profiles.findByHandle("anna"))?.id ?? "";
    await followActor(deps, {
      localActor: actor,
      followId: `${remote("ben").id}#follow`,
      follower: remote("ben"),
    });
    return { device, actor };
  }

  it("sends a link-only plan's Update and cancel to its participants from the instance actor", async () => {
    const device = await logIn();
    const planId = await plan(device, { visibility: "link" });
    await join(planId, remote("uma"));
    await join(planId, remote("vic", "other.example"), "tentative");
    publisher.sent.length = 0;
    later(1);
    await edit(device, planId, { exactDescription: "South gate" });
    expect(sentActivities()).toEqual([]);
    await edit(device, planId, { title: "Hill repeats" });
    await cancelPlan(deps, { planId, deviceToken: device });
    expect(sentActivities().map((sent) => sent.kind)).toEqual([
      "participantsUpdate",
      "participantsUpdate",
    ]);
    expect(sentActivities()[0]).toMatchObject({
      localActor: INSTANCE_ACTOR,
      planId,
      event: { title: "Hill repeats", status: "active" },
      to: ["https://social.example/users/uma", "https://other.example/users/vic"],
    });
    expect(sentActivities()[1]).toMatchObject({ event: { status: "cancelled" } });
    // The Event is the public one: no exact start, nothing private.
    const everything = JSON.stringify(sentActivities());
    for (const secret of ["North gate", "South gate", "48.16321", "11.60147"]) {
      expect(everything).not.toContain(secret);
    }
  });

  it("reaches participants who rejected or removed are not among", async () => {
    const device = await logIn();
    const planId = await plan(device, { joinMode: "approval" });
    await join(planId, remote("wes"));
    await join(planId, remote("xia"));
    const [wes] = await deps.responses.listByPlan(planId);
    await rejectRequest(deps, { planId, deviceToken: device, responseId: wes?.id ?? "" });
    later(1);
    await edit(device, planId, { title: "Changed" });
    expect(sentActivities().at(-1)).toMatchObject({
      kind: "participantsUpdate",
      to: ["https://social.example/users/xia"],
    });
  });

  it("sends the participants their own Update beside the followers', so no server sees who else took part", async () => {
    const { device, actor } = await sharing();
    const planId = await plan(device, { visibility: "public" });
    await join(planId, remote("ben"));
    await join(planId, remote("yan", "other.example"));
    publisher.sent.length = 0;
    later(1);
    await edit(device, planId, { title: "Hill repeats" });
    // The followers' Update names no participant; each participant is addressed alone.
    expect(sentActivities()).toHaveLength(2);
    expect(sentActivities()[0]).toMatchObject({
      kind: "update",
      localActor: actor,
      to: ["https://social.example/users/ben"],
    });
    expect(sentActivities()[1]).toMatchObject({
      kind: "participantsUpdate",
      localActor: actor,
      to: ["https://social.example/users/ben", "https://other.example/users/yan"],
    });
  });

  it("keeps the participants when the plan is narrowed, and Updates them from the instance actor after", async () => {
    const { device } = await sharing();
    const planId = await plan(device, { visibility: "public" });
    await join(planId, remote("zoe", "other.example"));
    publisher.sent.length = 0;
    later(1);
    await edit(device, planId, { visibility: "followers" });
    // The Delete reaches the followers only; nothing for Zoe.
    expect(sentActivities()).toHaveLength(1);
    expect(sentActivities()[0]).toMatchObject({
      kind: "withdraw",
      audience: "public",
      to: ["https://social.example/users/ben"],
    });
    publisher.sent.length = 0;
    await edit(device, planId, { title: "Still on" });
    expect(sentActivities()).toHaveLength(1);
    expect(sentActivities()[0]).toMatchObject({
      kind: "participantsUpdate",
      localActor: INSTANCE_ACTOR,
      to: ["https://other.example/users/zoe"],
    });
  });

  it("sends nothing to participants while federation is off", async () => {
    const device = await logIn();
    const planId = await plan(device);
    await join(planId, remote("abe"));
    publisher.sent.length = 0;
    withFederation(false);
    later(1);
    await edit(device, planId, { title: "Changed" });
    await deletePlan(deps, { planId, deviceToken: device });
    expect(sentActivities()).toEqual([]);
  });

  describe("every deletion path sends Delete to the participants, read before they go", () => {
    const deletions: [
      string,
      (device: string, planId: string) => Promise<unknown>,
      Partial<PlanInput>?,
    ][] = [
      ["the host", (device, planId) => deletePlan(deps, { planId, deviceToken: device })],
      [
        "the host, keeping a template",
        (device, planId) => deletePlan(deps, { planId, deviceToken: device }),
        { keepAsTemplate: "1" },
      ],
      [
        "the instance admin",
        (_device, planId) => {
          const adminAuth = new FakeAdminAuth();
          const session = adminAuth.startSession(clock.now()).value;
          return deletePlanAsAdmin({ ...deps, adminAuth }, { planId, session });
        },
      ],
      ["deleting the account", (device) => deleteAccount(deps, { deviceToken: device })],
      [
        "the retention sweep",
        async (_device, planId) => {
          clock.set((await stored(planId)).deleteAt.toISOString());
          return runRetentionSweep(deps);
        },
      ],
      [
        "a lower maximum retention",
        async () => {
          clock.set(new Date(sampleStart.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString());
          return applyRetentionMax(deps, { maxRetentionDays: 1 });
        },
        { retentionDays: "30" },
      ],
      [
        "a retention edit that deletes now",
        async (device, planId) => {
          clock.set(new Date(sampleStart.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString());
          return editPlan(deps, {
            planId,
            deviceToken: device,
            input: { ...planToInput(await stored(planId), "metric"), retentionDays: "1" },
            units: "metric",
            confirmDeleteNow: true,
          });
        },
      ],
    ];

    it.each(deletions)("%s", async (_path, remove, input = {}) => {
      const device = await logIn();
      const planId = await plan(device, { visibility: "link", ...input });
      await join(planId, remote("cat", "one.example"));
      await join(planId, remote("dee", "two.example"), "tentative");
      publisher.sent.length = 0;
      await remove(device, planId);
      expect(await deps.plans.findById(planId)).toBeUndefined();
      expect(sentActivities()).toEqual([
        {
          kind: "participantsDelete",
          localActor: INSTANCE_ACTOR,
          planId,
          to: ["https://one.example/users/cat", "https://two.example/users/dee"],
        },
      ]);
    });

    it("sends Delete when an anonymous device deletes its data", async () => {
      const created = await createPlan(deps, {
        input: { ...sampleInput, visibility: "link" },
        units: "metric",
        language: "en",
        creationNonce: nonce(),
        deviceToken: undefined,
      });
      if (created.kind !== "created") throw new Error("not created");
      await join(created.planId, remote("gil", "one.example"));
      publisher.sent.length = 0;
      await deleteMyData(deps, { deviceToken: created.newDeviceToken });
      expect(sentActivities()).toEqual([
        {
          kind: "participantsDelete",
          localActor: INSTANCE_ACTOR,
          planId: created.planId,
          to: ["https://one.example/users/gil"],
        },
      ]);
    });

    it("sends the final Delete to a plan narrowed to link-only, with its participants kept", async () => {
      const { device } = await sharing();
      const planId = await plan(device, { visibility: "public" });
      await join(planId, remote("eve", "one.example"));
      await edit(device, planId, { visibility: "link" });
      publisher.sent.length = 0;
      await deletePlan(deps, { planId, deviceToken: device });
      expect(sentActivities()).toEqual([
        {
          kind: "participantsDelete",
          localActor: INSTANCE_ACTOR,
          planId,
          to: ["https://one.example/users/eve"],
        },
      ]);
    });

    it("sends the participants their own Delete beside the followers', from the poster's actor", async () => {
      const { device, actor } = await sharing();
      const planId = await plan(device, { visibility: "public" });
      await join(planId, remote("ben"));
      await join(planId, remote("fox", "one.example"));
      publisher.sent.length = 0;
      await deletePlan(deps, { planId, deviceToken: device });
      expect(sentActivities()).toHaveLength(2);
      expect(sentActivities()[0]).toMatchObject({
        kind: "withdraw",
        localActor: actor,
        to: ["https://social.example/users/ben"],
      });
      expect(sentActivities()[1]).toMatchObject({
        kind: "participantsDelete",
        localActor: actor,
        to: ["https://social.example/users/ben", "https://one.example/users/fox"],
      });
    });

    it("reaches the rejected and the removed with the final Delete, but not with an Update", async () => {
      const device = await logIn();
      const planId = await plan(device, { joinMode: "approval" });
      for (const name of ["kay", "lee", "max", "ned"]) await join(planId, remote(name));
      const idOf = async (name: string) =>
        (await deps.responses.listByPlan(planId)).find((r) => r.displayName.startsWith(`${name}@`))
          ?.id ?? "";
      const by = { planId, deviceToken: device };
      await rejectRequest(deps, { ...by, responseId: await idOf("kay") });
      await acceptRequest(deps, { ...by, responseId: await idOf("lee") });
      await removePerson(deps, { ...by, responseId: await idOf("lee") });
      await acceptRequest(deps, { ...by, responseId: await idOf("max") });
      publisher.sent.length = 0;
      later(1);
      await edit(device, planId, { title: "Changed" });
      expect(sentActivities()).toMatchObject([
        {
          kind: "participantsUpdate",
          to: ["https://social.example/users/max", "https://social.example/users/ned"],
        },
      ]);
      publisher.sent.length = 0;
      await deletePlan(deps, { planId, deviceToken: device });
      expect(sentActivities()).toMatchObject([
        {
          kind: "participantsDelete",
          to: [
            "https://social.example/users/kay",
            "https://social.example/users/lee",
            "https://social.example/users/max",
            "https://social.example/users/ned",
          ],
        },
      ]);
    });
  });
});
