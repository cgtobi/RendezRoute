// Private direct Notes to accepted remote participants (spec 7 ActivityPub; decision D43; 0.9 step
// 11b): the exact start and route go, from the plan's attributed actor and to that actor alone, to
// a remote participant who joined; changes are sent again, and the Note is withdrawn when they
// leave, are removed, or the plan is deleted.
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { deleteAccount } from "../../src/application/account-data.ts";
import { deletePlanAsAdmin } from "../../src/application/admin.ts";
import { type AccountDeps, finishLogin, startLogin } from "../../src/application/accounts.ts";
import { createProfile, retireProfile } from "../../src/application/fediverse-profile.ts";
import { INSTANCE_ACTOR } from "../../src/application/following.ts";
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
import { removeRoute, setRoute } from "../../src/application/routes.ts";
import { fakeGpx } from "../fakes/route-parser.ts";
import { routeForNoteLink, syncParticipantNotes } from "../../src/application/participant-notes.ts";
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
import { FakeClock } from "../fakes/clock.ts";
import {
  FakeActorKeys,
  FakeFediverseProfiles,
  FakeFollowers,
  FakeParticipantNotes,
  FakePublications,
  FakePublisher,
} from "../fakes/fediverse-profiles.ts";
import { FakeIdentityProvider } from "../fakes/identity-provider.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
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

const withFederation = (enabled: boolean) => {
  deps = { ...deps, posterActors: { ...deps.posterActors!, enabled } };
};

const notes = () => deps.posterActors!.notes as FakeParticipantNotes;
const route = (lat: number) => ({
  segments: [
    [
      { lat, lng: 10.9, ele: 800 },
      { lat: lat + 0.01, lng: 10.9, ele: 850 },
    ],
  ],
});
/** What was sent about Notes, as "create ben", "update ben", "delete ben". */
const noteActivities = () =>
  publisher.sent.flatMap((sent) =>
    sent.kind === "note"
      ? [`${sent.activity} ${sent.to.split("/").at(-1)}`]
      : sent.kind === "noteDelete"
        ? [`delete ${sent.to.split("/").at(-1)}`]
        : [],
  );
const idOf = async (planId: string, name: string) =>
  (await deps.responses.listByPlan(planId)).find((r) => r.displayName.startsWith(`${name}@`))?.id ??
  "";

describe("a Note for a participant who joined (decision D43)", () => {
  it("is sent to a joined participant only, after the Accept, from the instance actor, to that actor alone", async () => {
    const device = await logIn();
    const planId = await plan(device, {
      exactDescription: "Kiosk at the bridge",
      exactLat: "48.1234",
      exactLng: "11.5678",
    });
    await join(planId, remote("ben"));
    expect(publisher.sent.map((sent) => sent.kind)).toEqual(["answer", "note"]);
    const [, sent] = publisher.sent;
    expect(sent).toMatchObject({
      kind: "note",
      activity: "create",
      to: "https://social.example/users/ben",
      note: {
        planId,
        localActor: INSTANCE_ACTOR,
        language: "en",
        title: "Easy Sunday run",
        timeZone: "Europe/Berlin",
        startsAt: sampleStart,
        exactStart: { description: "Kiosk at the bridge", point: { lat: 48.1234, lng: 11.5678 } },
        routeToken: undefined,
      },
    });
    expect(await notes().listByPlan(planId)).toHaveLength(1);
  });

  it("is not sent to someone interested, requesting, rejected or removed", async () => {
    const device = await logIn();
    const planId = await plan(device, { joinMode: "approval" });
    await join(planId, remote("ida"), "tentative");
    await join(planId, remote("rae"));
    await join(planId, remote("rob"));
    await join(planId, remote("sam"));
    const by = { planId, deviceToken: device };
    await rejectRequest(deps, { ...by, responseId: await idOf(planId, "rob") });
    await acceptRequest(deps, { ...by, responseId: await idOf(planId, "sam") });
    await removePerson(deps, { ...by, responseId: await idOf(planId, "sam") });
    // Sam was a participant, so Sam's Note was sent and withdrawn; the others never had one.
    expect(noteActivities()).toEqual(["create sam", "delete sam"]);
    expect(await notes().listByPlan(planId)).toEqual([]);
  });

  it("is sent when the host accepts a request, restores a person, or switches to open mode", async () => {
    const device = await logIn();
    const planId = await plan(device, { joinMode: "approval" });
    for (const name of ["ann", "bea", "cal", "dan"]) await join(planId, remote(name));
    const by = { planId, deviceToken: device };
    await acceptRequest(deps, { ...by, responseId: await idOf(planId, "ann") });
    expect(noteActivities()).toEqual(["create ann"]);
    await removePerson(deps, { ...by, responseId: await idOf(planId, "ann") });
    await restorePerson(deps, { ...by, responseId: await idOf(planId, "ann") });
    // Restored in approval mode: pending again, no Note; the others are accepted by the switch.
    expect(noteActivities()).toEqual(["create ann", "delete ann"]);
    expect(
      await editPlan(deps, {
        planId,
        deviceToken: device,
        input: { ...planToInput(await stored(planId), "metric"), joinMode: "open" },
        units: "metric",
        confirmDeleteNow: false,
        confirmAcceptPending: 4,
      }),
    ).toMatchObject({ kind: "updated" });
    expect(noteActivities().slice(2).sort()).toEqual([
      "create ann",
      "create bea",
      "create cal",
      "create dan",
    ]);
    // Restored to joined in open mode: removed and restored again.
    await removePerson(deps, { ...by, responseId: await idOf(planId, "bea") });
    publisher.sent.length = 0;
    await restorePerson(deps, { ...by, responseId: await idOf(planId, "bea") });
    expect(noteActivities()).toEqual(["create bea"]);
  });

  it("is sent from the poster's actor on a plan its profile shares", async () => {
    const device = await logIn();
    await createProfile(deps, { deviceToken: device, handle: "anna" });
    const actor = (await profiles.findByHandle("anna"))?.id ?? "";
    const planId = await plan(device, { visibility: "followers" });
    await join(planId, remote("eli", "other.example"));
    expect(publisher.sent.at(-1)).toMatchObject({ kind: "note", note: { localActor: actor } });
  });

  it("is not sent while federation is off, nor for a plan with nothing private to send", async () => {
    const device = await logIn();
    const planId = await plan(device);
    withFederation(false);
    await join(planId, remote("fay"));
    expect(publisher.sent).toEqual([]);
    expect(await notes().listByPlan(planId)).toEqual([]);
  });

  it("has a secret link for the route, from a token only the Note knows", async () => {
    const device = await logIn();
    const planId = await plan(device);
    expect(
      await setRoute(deps, { planId, deviceToken: device, gpx: fakeGpx(route(47.1)) }),
    ).toEqual({ kind: "saved" });
    await join(planId, remote("gus"));
    const sent = publisher.sent.find((item) => item.kind === "note");
    const token = sent?.kind === "note" ? sent.note.routeToken : undefined;
    expect(token).toMatch(/^token-/);
    expect(await routeForNoteLink(deps, token ?? "")).toMatchObject({
      kind: "found",
      title: "Easy Sunday run",
      route: route(47.1),
    });
    expect(await routeForNoteLink(deps, "token-9999")).toEqual({ kind: "not_found" });
    withFederation(false);
    expect(await routeForNoteLink(deps, token ?? "")).toEqual({ kind: "not_found" });
  });
});

describe("a change that goes to the participants' Notes", () => {
  async function joined(input: Partial<PlanInput> = {}) {
    const device = await logIn();
    const planId = await plan(device, input);
    await join(planId, remote("hal"));
    publisher.sent.length = 0;
    later(1);
    return { device, planId };
  }

  it("is an Update for a changed exact start or start time, none for a title or an unchanged edit", async () => {
    const { device, planId } = await joined({
      exactDescription: "Old gate",
      exactLat: "48.2",
      exactLng: "11.2",
    });
    await edit(device, planId, { title: "Another title" });
    await edit(device, planId, {});
    expect(noteActivities()).toEqual([]);
    await edit(device, planId, { exactDescription: "New gate" });
    expect(noteActivities()).toEqual(["update hal"]);
    expect(publisher.sent.at(-1)).toMatchObject({
      note: { exactStart: { description: "New gate", point: { lat: 48.2, lng: 11.2 } } },
    });
    await edit(device, planId, { exactLat: "48.9", exactLng: "11.9" });
    expect(noteActivities()).toEqual(["update hal", "update hal"]);
    await edit(device, planId, { time: "09:15" });
    expect(noteActivities()).toEqual(["update hal", "update hal", "update hal"]);
    expect(publisher.sent.at(-1)).toMatchObject({
      note: { startsAt: new Date("2026-06-07T07:15:00Z") },
    });
  });

  it("keeps the Note's identifier through Updates", async () => {
    const { device, planId } = await joined();
    const [before] = await notes().listByPlan(planId);
    await edit(device, planId, { exactDescription: "Elsewhere" });
    const [after] = await notes().listByPlan(planId);
    expect(after?.noteId).toBe(before?.noteId);
    expect(publisher.sent.at(-1)).toMatchObject({ note: { noteId: before?.noteId } });
  });

  it("gives a replaced route a new link and revokes the old one; a removed route has none", async () => {
    const { device, planId } = await joined();
    expect(
      await setRoute(deps, { planId, deviceToken: device, gpx: fakeGpx(route(47.1)) }),
    ).toEqual({ kind: "saved" });
    const first = (publisher.sent.at(-1) as { note: { routeToken?: string } }).note.routeToken;
    expect(noteActivities()).toEqual(["update hal"]);
    expect(first).toBeDefined();
    expect(
      await setRoute(deps, { planId, deviceToken: device, gpx: fakeGpx(route(47.3)) }),
    ).toEqual({ kind: "saved" });
    const second = (publisher.sent.at(-1) as { note: { routeToken?: string } }).note.routeToken;
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(await routeForNoteLink(deps, first ?? "")).toEqual({ kind: "not_found" });
    expect(await routeForNoteLink(deps, second ?? "")).toMatchObject({
      kind: "found",
      route: route(47.3),
    });
    // The same route again changes nothing.
    publisher.sent.length = 0;
    await setRoute(deps, { planId, deviceToken: device, gpx: fakeGpx(route(47.3)) });
    expect(noteActivities()).toEqual([]);
    expect(await removeRoute(deps, { planId, deviceToken: device })).toEqual({ kind: "removed" });
    expect(noteActivities()).toEqual(["update hal"]);
    expect(publisher.sent.at(-1)).toMatchObject({ note: { routeToken: undefined } });
    expect(await routeForNoteLink(deps, second ?? "")).toEqual({ kind: "not_found" });
  });

  it("keeps the Note when the plan is cancelled", async () => {
    const { device, planId } = await joined();
    await cancelPlan(deps, { planId, deviceToken: device });
    expect(noteActivities()).toEqual([]);
    expect(await notes().listByPlan(planId)).toHaveLength(1);
  });

  it("is not sent while federation is off", async () => {
    const { device, planId } = await joined();
    withFederation(false);
    await edit(device, planId, { exactDescription: "Elsewhere" });
    await syncParticipantNotes(deps, await stored(planId));
    expect(publisher.sent).toEqual([]);
  });
});

describe("withdrawing a Note", () => {
  it("is a Delete, and the link dies, when the participant leaves, is removed, changes to interested or is deleted", async () => {
    const device = await logIn();
    const planId = await plan(device);
    await setRoute(deps, { planId, deviceToken: device, gpx: fakeGpx(route(47.5)) });
    for (const name of ["ivy", "jon", "kim", "lou"]) await join(planId, remote(name));
    const tokens = new Map(
      (await notes().listByPlan(planId)).map((n) => [n.responseId, n.routeToken]),
    );
    expect(tokens.size).toBe(4);
    publisher.sent.length = 0;
    await leaveRemote(deps, { planId, actorId: remote("ivy").id });
    await removePerson(deps, {
      planId,
      deviceToken: device,
      responseId: await idOf(planId, "jon"),
    });
    await join(planId, remote("kim"), "tentative", { n: 2 });
    await forgetRemoteParticipant(deps, remote("lou").id);
    expect(noteActivities().sort()).toEqual([
      "delete ivy",
      "delete jon",
      "delete kim",
      "delete lou",
    ]);
    expect(await notes().listByPlan(planId)).toEqual([]);
    for (const token of tokens.values()) {
      expect(await routeForNoteLink(deps, token ?? "")).toEqual({ kind: "not_found" });
    }
    // Each Delete names the Note it withdraws.
    for (const sent of publisher.sent.filter((item) => item.kind === "noteDelete")) {
      expect(sent).toMatchObject({ planId, localActor: INSTANCE_ACTOR });
    }
  });

  it("is a Delete when the actor deletes itself, for every plan it joined", async () => {
    const device = await logIn();
    const first = await plan(device, { title: "First" });
    const second = await plan(device, { title: "Second" });
    await join(first, remote("mia"));
    await join(second, remote("mia"));
    publisher.sent.length = 0;
    await forgetRemoteParticipant(deps, remote("mia").id);
    expect(noteActivities()).toEqual(["delete mia", "delete mia"]);
    expect(
      new Set(publisher.sent.map((sent) => (sent.kind === "noteDelete" ? sent.planId : ""))),
    ).toEqual(new Set([first, second]));
  });

  describe("on every deletion path, before the plan goes", () => {
    const sampleLater = () =>
      new Date(sampleStart.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();
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
          clock.set(sampleLater());
          return applyRetentionMax(deps, { maxRetentionDays: 1 });
        },
        { retentionDays: "30" },
      ],
      [
        "a retention edit that deletes now",
        async (device, planId) => {
          clock.set(sampleLater());
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

    describe.each([
      ["a link-only plan", false],
      ["a plan its profile shares", true],
    ])("of %s", (_kind, shared) => {
      it.each(deletions)("%s", async (_path, remove, input = {}) => {
        const device = await logIn();
        let sender = INSTANCE_ACTOR;
        if (shared) {
          await createProfile(deps, { deviceToken: device, handle: "anna" });
          sender = (await profiles.findByHandle("anna"))?.id ?? "";
        }
        const planId = await plan(device, { ...input, visibility: shared ? "public" : "link" });
        await join(planId, remote("cat", "one.example"));
        await join(planId, remote("dee", "two.example"));
        await join(planId, remote("eve", "three.example"), "tentative");
        publisher.sent.length = 0;
        await remove(device, planId);
        expect(await deps.plans.findById(planId)).toBeUndefined();
        const deletes = publisher.sent.filter((sent) => sent.kind === "noteDelete");
        expect(
          deletes
            .map((sent) => (sent.kind === "noteDelete" ? sent.to : ""))
            .sort((a, b) => a.localeCompare(b)),
        ).toEqual(["https://one.example/users/cat", "https://two.example/users/dee"]);
        // From the actor that sent the Note: a server ignores a Delete from anyone else.
        for (const sent of deletes) expect(sent).toMatchObject({ planId, localActor: sender });
      });
    });

    it("sends the Delete for an anonymous device's data", async () => {
      const created = await createPlan(deps, {
        input: { ...sampleInput },
        units: "metric",
        language: "en",
        creationNonce: nonce(),
        deviceToken: undefined,
      });
      if (created.kind !== "created") throw new Error("not created");
      await join(created.planId, remote("fox", "one.example"));
      publisher.sent.length = 0;
      await deleteMyData(deps, { deviceToken: created.newDeviceToken });
      expect(noteActivities()).toEqual(["delete fox"]);
    });
  });
});

describe("the Accept", () => {
  it("is told the plan's language for its notice", async () => {
    const device = await logIn();
    const planId = await plan(device);
    await join(planId, remote("gil"));
    expect(publisher.sent[0]).toMatchObject({ kind: "answer", answer: "accept", language: "en" });
  });
});

/** A profile that shares a public plan, with a participant who does not follow it. */
async function sharedWithParticipant(name = "ben", server = "other.example") {
  const device = await logIn();
  await createProfile(deps, { deviceToken: device, handle: "anna" });
  const actor = (await profiles.findByHandle("anna"))?.id ?? "";
  const planId = await plan(device, { visibility: "public" });
  await join(planId, remote(name, server));
  publisher.sent.length = 0;
  return { device, actor, planId, to: remote(name, server).id };
}

describe("the sender of a Note stays the one that sent it (decision D43)", () => {
  it("stores the actor, and Creates, Updates and Deletes from it, whatever attribution says later", async () => {
    const { device, actor, planId } = await sharedWithParticipant();
    expect((await notes().listByPlan(planId))[0]).toMatchObject({ localActor: actor });
    later(1);
    // Narrowed: withdrawn for the followers, so the plan is the instance's now; the Note is not.
    await edit(device, planId, { visibility: "followers" });
    await edit(device, planId, { visibility: "link" });
    publisher.sent.length = 0;
    await edit(device, planId, { exactDescription: "Boat house at the lock" });
    expect(publisher.sent.filter((sent) => sent.kind === "note")).toMatchObject([
      { activity: "update", localActor: actor },
    ]);
    publisher.sent.length = 0;
    await deletePlan(deps, { planId, deviceToken: device });
    expect(publisher.sent.filter((sent) => sent.kind === "noteDelete")).toMatchObject([
      { localActor: actor },
    ]);
  });

  it("falls back to the instance actor once the stored actor can no longer sign", async () => {
    const { device, planId } = await sharedWithParticipant();
    const [profile] = [...profiles.profiles.values()];
    await profiles.retire(profile?.identityId ?? "", clock.now());
    later(1);
    await edit(device, planId, { exactDescription: "Boat house at the lock" });
    expect(publisher.sent.filter((sent) => sent.kind === "note")).toMatchObject([
      { activity: "update", localActor: INSTANCE_ACTOR },
    ]);
    publisher.sent.length = 0;
    await deletePlan(deps, { planId, deviceToken: device });
    expect(publisher.sent.filter((sent) => sent.kind === "noteDelete")).toMatchObject([
      { localActor: INSTANCE_ACTOR },
    ]);
  });

  it("is withdrawn from the profile, with its key carried, and sent again from the instance, when the profile is turned off", async () => {
    const { device, actor, planId, to } = await sharedWithParticipant();
    const [old] = await notes().listByPlan(planId);
    expect(await retireProfile(deps, { deviceToken: device })).toMatchObject({ kind: "retired" });
    // The old Note goes from the profile, the participant keeps the exact start in a new one.
    expect(
      publisher.sent.filter((sent) => sent.kind === "noteDelete" || sent.kind === "note"),
    ).toMatchObject([
      { kind: "noteDelete", noteId: old?.noteId, planId, localActor: actor, to, carryKey: true },
      { kind: "note", activity: "create", localActor: INSTANCE_ACTOR, to },
    ]);
    const [fresh] = await notes().listByPlan(planId);
    expect(fresh).toMatchObject({ localActor: INSTANCE_ACTOR });
    expect(fresh?.noteId).not.toBe(old?.noteId);
  });

  it("is withdrawn from the profile, with its key carried, when the account is deleted", async () => {
    const { device, actor, planId, to } = await sharedWithParticipant();
    expect(await deleteAccount(deps, { deviceToken: device })).toEqual({ kind: "deleted" });
    const deletes = publisher.sent.filter((sent) => sent.kind === "noteDelete");
    expect(deletes).toEqual([
      {
        kind: "noteDelete",
        noteId: expect.any(String),
        planId,
        localActor: actor,
        to,
        carryKey: true,
      },
    ]);
    // The plans go with the account: no new Note is sent to anyone.
    expect(publisher.sent.filter((sent) => sent.kind === "note")).toEqual([]);
  });
});

describe("a plan with nothing private to send", () => {
  const bare = { exactDescription: "", exactLat: "", exactLng: "" };

  it("gives no Note, until the host adds an exact start, or a route", async () => {
    const device = await logIn();
    const planId = await plan(device, bare);
    expect((await stored(planId)).exactStart).toBeUndefined();
    await join(planId, remote("hal"));
    expect(noteActivities()).toEqual([]);
    expect(await notes().listByPlan(planId)).toEqual([]);
    later(1);
    await edit(device, planId, { exactDescription: "Boat house at the lock" });
    expect(noteActivities()).toEqual(["create hal"]);

    const routed = await plan(device, bare);
    await join(routed, remote("ida"));
    publisher.sent.length = 0;
    expect(
      await setRoute(deps, { planId: routed, deviceToken: device, gpx: fakeGpx(route(47.4)) }),
    ).toEqual({ kind: "saved" });
    expect(noteActivities()).toEqual(["create ida"]);
  });

  it("is withdrawn when the last private thing goes, not updated with nothing in it", async () => {
    const device = await logIn();
    const planId = await plan(device, bare);
    await setRoute(deps, { planId, deviceToken: device, gpx: fakeGpx(route(47.4)) });
    await join(planId, remote("jan"));
    const token = (await notes().listByPlan(planId))[0]?.routeToken ?? "";
    expect(token).not.toBe("");
    // A route sets the meeting point, so the exact start is taken away by hand, as the route is.
    await deps.plans.update({ ...(await stored(planId)), exactStart: undefined });
    await deps.plans.deleteRoute(planId);
    publisher.sent.length = 0;
    await syncParticipantNotes(deps, await stored(planId));
    expect(noteActivities()).toEqual(["delete jan"]);
    expect(await notes().listByPlan(planId)).toEqual([]);
    expect(await routeForNoteLink(deps, token)).toEqual({ kind: "not_found" });
  });
});

const responsesOf = async (planId: string) =>
  (await deps.responses.listRemote(planId)).map((entry) => [
    entry.actor.id.split("/").at(-1),
    entry.response.kind,
  ]);

/** A joined remote participant with no Note: the host accepted the request while federation was off. */
async function joinedWithoutNote(name: string) {
  const device = await logIn();
  const planId = await plan(device, { joinMode: "approval" });
  await join(planId, remote(name));
  withFederation(false);
  await acceptRequest(deps, { planId, deviceToken: device, responseId: await idOf(planId, name) });
  withFederation(true);
  expect(noteActivities()).toEqual([]);
  expect(await responsesOf(planId)).toEqual([[name, "joined"]]);
  return { device, planId };
}

describe("a Note that is sent once", () => {
  it("is created once by two attempts at the same moment", async () => {
    const { planId } = await joinedWithoutNote("kim");
    await Promise.all([
      syncParticipantNotes(deps, await stored(planId)),
      syncParticipantNotes(deps, await stored(planId)),
    ]);
    expect(noteActivities()).toEqual(["create kim"]);
    expect(await notes().listByPlan(planId)).toHaveLength(1);
  });

  it("is sent only by the attempt that stored it", async () => {
    const { planId } = await joinedWithoutNote("pam");
    // The other attempt got there first: the store says nothing was stored.
    notes().create = () => Promise.resolve(false);
    await syncParticipantNotes(deps, await stored(planId));
    expect(noteActivities()).toEqual([]);
  });

  it("appears when a joined participant, accepted while federation was off, joins again", async () => {
    const { planId } = await joinedWithoutNote("lou");
    await join(planId, remote("lou"), "join", { n: 2 });
    expect(noteActivities()).toEqual(["create lou"]);
  });

  it("is withdrawn from the queue first, so a failure to queue loses nothing", async () => {
    const device = await logIn();
    const planId = await plan(device);
    await join(planId, remote("max"));
    publisher.sent.length = 0;
    const withdraw = publisher.withdrawParticipantNote.bind(publisher);
    let failures = 1;
    publisher.withdrawParticipantNote = (note, recipient, options) => {
      if (failures-- > 0) return Promise.reject(new Error("queue down"));
      return withdraw(note, recipient, options);
    };
    await expect(leaveRemote(deps, { planId, actorId: remote("max").id })).rejects.toThrow(
      "queue down",
    );
    expect(await notes().listByPlan(planId)).toHaveLength(1);
    await leaveRemote(deps, { planId, actorId: remote("max").id });
    expect(noteActivities()).toEqual(["delete max"]);
    expect(await notes().listByPlan(planId)).toEqual([]);
  });

  it("says when it was published and when updated", async () => {
    const device = await logIn();
    const planId = await plan(device);
    await join(planId, remote("ned"));
    const created = publisher.sent.find((sent) => sent.kind === "note");
    expect(created).toMatchObject({ note: { publishedAt: fixtureNow, updatedAt: undefined } });
    later(10);
    await edit(device, planId, { exactDescription: "Boat house at the lock" });
    const update = publisher.sent.filter((sent) => sent.kind === "note").at(-1);
    expect(update).toMatchObject({
      activity: "update",
      note: { publishedAt: fixtureNow, updatedAt: clock.now() },
    });
  });
});
