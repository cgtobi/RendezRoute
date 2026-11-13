// Recap contributions over federation (spec 6 recap, 7 ActivityPub; decisions D44, D45; 0.9 step
// 12a): every visible contribution goes as a direct Note to each joined remote participant but its
// author, with an Update on edit and a Delete whenever the web stops showing it to them; a late
// joiner gets the newest 50; replies from joined remote participants become contributions.
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
import {
  addRemoteContribution,
  deleteRemoteContribution,
  editRemoteContribution,
} from "../../src/application/remote-contributions.ts";
import { publishContribution } from "../../src/application/contribution-notes.ts";
import { createPlan } from "../../src/application/plans.ts";
import type { ProviderAccount, RemoteActor } from "../../src/application/ports.ts";
import {
  addContribution,
  deleteContribution,
  deleteRecap,
  editContribution,
  setContributionHidden,
} from "../../src/application/recap.ts";
import {
  forgetRemoteParticipant,
  joinRemote,
  leaveRemote,
} from "../../src/application/remote-participants.ts";
import { respond, updateMyResponse, withdrawMyResponse } from "../../src/application/responses.ts";
import { planToInput } from "../../src/domain/plan-edit.ts";
import type { PlanInput } from "../../src/domain/plan-input.ts";
import { CONTRIBUTION_LIMITS } from "../../src/domain/recap.ts";
import { FakeAdminAuth } from "../fakes/admin-auth.ts";
import { FakeClock } from "../fakes/clock.ts";
import {
  FakeActorKeys,
  FakeContributionNotes,
  FakeFediverseProfiles,
  FakeFollowers,
  FakeParticipantNotes,
  FakePublications,
  FakePublisher,
  FakeRemoteContributions,
} from "../fakes/fediverse-profiles.ts";
import { FakeIdentityProvider } from "../fakes/identity-provider.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

/** The sample plan starts 2026-06-07 07:30 in Berlin; its recap is open from then for a week. */
const STARTED = "2026-06-07T06:00:00Z";

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

const remote = (name: string, server = "social.example"): RemoteActor => ({
  id: `https://${server}/users/${name}`,
  inbox: `https://${server}/users/${name}/inbox`,
  sharedInbox: `https://${server}/inbox`,
});

const join = (planId: string, actor: RemoteActor, kind: "join" | "tentative" = "join", k = 1) =>
  joinRemote(deps, {
    planId,
    join: { id: `${actor.id}#${kind}-${k}`, kind },
    actor,
    username: actor.id.split("/").at(-1),
    mayNotifyHost: () => true,
  });

const idOf = async (planId: string, name: string) =>
  (await deps.responses.listByPlan(planId)).find((r) => r.displayName.startsWith(`${name}@`))?.id ??
  "";

/** A web participant who joined (open mode), with the device that writes for them. */
async function web(planId: string, name: string) {
  const result = await respond(deps, {
    planId,
    choice: "joined",
    displayName: name,
    requestNote: "",
    language: "en",
    creationNonce: nonce(),
    deviceToken: undefined,
  });
  if (result.kind !== "created") throw new Error(`respond failed: ${result.kind}`);
  const response = await deps.responses.findByManageTokenHash(deps.tokens.hash(result.manageToken));
  return { device: result.newDeviceToken, responseId: response?.id ?? "" };
}

const startRecap = () => clock.set(STARTED);
/**
 * Runs while the plan has not started: answers can only change then, and after the start the web
 * and the inbox refuse them, so these moves are made at an earlier time to reach their hooks.
 */
async function beforeStart<T>(act: () => Promise<T>): Promise<T> {
  const at = clock.now();
  clock.set(fixtureNow.toISOString());
  try {
    return await act();
  } finally {
    clock.set(at.toISOString());
  }
}
const contributionsOf = (planId: string) => deps.recap.listByPlan(planId);
const contributionNotes = () => deps.posterActors!.contributionNotes as FakeContributionNotes;
const short = (uri: string) => uri.split("/").at(-1);

/** The Notes sent, as "create ben: text". */
const sentNotes = () =>
  publisher.sent.flatMap((sent) =>
    sent.kind === "contributionNote"
      ? [`${sent.activity} ${short(sent.to)}: ${sent.note.body ?? sent.note.linkUrl ?? ""}`]
      : [],
  );
const sentDeletes = () =>
  publisher.sent.flatMap((sent) =>
    sent.kind === "contributionNoteDelete" ? [`delete ${short(sent.to)}`] : [],
  );
const deletesOf = () => publisher.sent.filter((sent) => sent.kind === "contributionNoteDelete");
const sorted = (items: string[]) => items.sort((a, b) => a.localeCompare(b));

/** A plan hosted by a signed-in Anna, with two remote participants and Wanda, who joined; then it starts. */
async function setup() {
  const device = await logIn();
  const planId = await plan(device);
  await join(planId, remote("ben"));
  await join(planId, remote("cat", "other.example"));
  const wanda = await web(planId, "Wanda");
  startRecap();
  publisher.sent.length = 0;
  return { device, planId, wanda };
}

describe("a new contribution (decision D44)", () => {
  it("goes to every remote participant who joined, as the host's, and to no one else", async () => {
    const device = await logIn();
    const planId = await plan(device, { joinMode: "approval" });
    await join(planId, remote("ben"));
    await join(planId, remote("cat", "other.example"));
    await join(planId, remote("ida"), "tentative");
    await join(planId, remote("rae"));
    await join(planId, remote("rob"));
    await join(planId, remote("sam"));
    const by = { planId, deviceToken: device };
    await acceptRequest(deps, { ...by, responseId: await idOf(planId, "ben") });
    await acceptRequest(deps, { ...by, responseId: await idOf(planId, "cat") });
    await rejectRequest(deps, { ...by, responseId: await idOf(planId, "rob") });
    await acceptRequest(deps, { ...by, responseId: await idOf(planId, "sam") });
    await removePerson(deps, { ...by, responseId: await idOf(planId, "sam") });
    startRecap();
    publisher.sent.length = 0;

    expect(
      await addContribution(deps, { ...by, body: "Thanks all, see you!", linkUrl: "" }),
    ).toEqual({ kind: "added" });

    expect(sorted(sentNotes())).toEqual([
      "create ben: Thanks all, see you!",
      "create cat: Thanks all, see you!",
    ]);
    const [contribution] = await contributionsOf(planId);
    expect(publisher.sent[0]).toMatchObject({
      kind: "contributionNote",
      activity: "create",
      localActor: INSTANCE_ACTOR,
      note: {
        planId,
        contributionId: contribution?.id,
        language: "en",
        authorName: "Anna",
        body: "Thanks all, see you!",
        linkUrl: undefined,
        publishedAt: new Date(STARTED),
        updatedAt: undefined,
      },
    });
    expect(await contributionNotes().listByPlan(planId)).toHaveLength(2);
  });

  it("carries the author's name as the web shows it, and the link", async () => {
    const { planId, wanda } = await setup();
    await addContribution(deps, {
      planId,
      deviceToken: wanda.device,
      body: "Lovely loop",
      linkUrl: "https://photos.example/loop",
    });
    expect(publisher.sent.filter((s) => s.kind === "contributionNote")).toHaveLength(2);
    expect(publisher.sent[0]).toMatchObject({
      note: {
        authorName: "Wanda",
        body: "Lovely loop",
        linkUrl: "https://photos.example/loop",
        responseId: await idOf(planId, "ben"),
      },
    });
  });

  it("goes from the plan's profile on a plan it shares, and later changes come from that actor", async () => {
    const device = await logIn();
    await createProfile(deps, { deviceToken: device, handle: "anna" });
    const profileId = (await profiles.findByHandle("anna"))?.id ?? "";
    const planId = await plan(device, { visibility: "public" });
    await join(planId, remote("ben"));
    startRecap();
    publisher.sent.length = 0;
    await addContribution(deps, { planId, deviceToken: device, body: "First", linkUrl: "" });
    expect(publisher.sent[0]).toMatchObject({ kind: "contributionNote", localActor: profileId });
  });

  it("is not sent to its remote author, only to the others", async () => {
    const { planId } = await setup();
    expect(
      await addRemoteContribution(deps, {
        planId,
        actorId: remote("ben").id,
        noteId: "https://social.example/notes/1",
        addressedTo: [INSTANCE_ACTOR],
        body: "Ben's words",
        linkUrl: "",
      }),
    ).toBe("added");
    expect(sentNotes()).toEqual(["create cat: Ben's words"]);
    expect(publisher.sent[0]).toMatchObject({
      note: { authorName: "ben@social.example", body: "Ben's words" },
    });
  });

  it("is not sent while federation is off, nor are rows kept for it", async () => {
    const { device, planId } = await setup();
    deps = { ...deps, posterActors: { ...deps.posterActors!, enabled: false } };
    await addContribution(deps, { planId, deviceToken: device, body: "Quiet", linkUrl: "" });
    expect(publisher.sent).toEqual([]);
    expect(await contributionNotes().listByPlan(planId)).toEqual([]);
  });
});

describe("an edited contribution", () => {
  it("is an Update to each recipient when the text or the link changed, none when nothing did", async () => {
    const { device, planId } = await setup();
    await addContribution(deps, { planId, deviceToken: device, body: "Before", linkUrl: "" });
    const [contribution] = await contributionsOf(planId);
    const ids = new Set((await contributionNotes().listByPlan(planId)).map((note) => note.noteId));
    publisher.sent.length = 0;
    const edit = (body: string, linkUrl = "") =>
      editContribution(deps, {
        planId,
        contributionId: contribution?.id ?? "",
        deviceToken: device,
        body,
        linkUrl,
      });

    await edit("Before");
    expect(publisher.sent).toEqual([]);

    await edit("After");
    expect(sorted(sentNotes())).toEqual(["update ben: After", "update cat: After"]);
    expect(
      new Set(publisher.sent.map((s) => (s.kind === "contributionNote" ? s.note.noteId : ""))),
    ).toEqual(ids);
    expect(publisher.sent[0]).toMatchObject({
      note: { publishedAt: new Date(STARTED), updatedAt: new Date(STARTED) },
    });

    publisher.sent.length = 0;
    await edit("After", "https://trail.example/map");
    expect(publisher.sent).toHaveLength(2);
    expect(publisher.sent[0]).toMatchObject({ note: { linkUrl: "https://trail.example/map" } });

    publisher.sent.length = 0;
    await edit("After", "https://trail.example/map");
    expect(publisher.sent).toEqual([]);
  });

  it("is an Update when the author's name changes, for their contributions only", async () => {
    const { device, planId, wanda } = await setup();
    await addContribution(deps, { planId, deviceToken: wanda.device, body: "Mine", linkUrl: "" });
    await addContribution(deps, { planId, deviceToken: device, body: "Host's", linkUrl: "" });
    publisher.sent.length = 0;
    await updateMyResponse(deps, {
      planId,
      deviceToken: wanda.device,
      choice: "joined",
      displayName: "Wanda W.",
    });
    expect(
      publisher.sent.map((s) =>
        s.kind === "contributionNote" ? `${s.activity} ${s.note.authorName}` : s.kind,
      ),
    ).toEqual(["update Wanda W.", "update Wanda W."]);
  });

  it("sends nothing for a contribution the host hid", async () => {
    const { device, planId, wanda } = await setup();
    await addContribution(deps, { planId, deviceToken: wanda.device, body: "Mine", linkUrl: "" });
    const [contribution] = await contributionsOf(planId);
    const by = { planId, contributionId: contribution?.id ?? "" };
    await setContributionHidden(deps, { ...by, deviceToken: device, hidden: true });
    publisher.sent.length = 0;
    await editContribution(deps, {
      ...by,
      deviceToken: wanda.device,
      body: "Changed",
      linkUrl: "",
    });
    expect(publisher.sent).toEqual([]);
  });
});

describe("withdrawing a contribution's Notes", () => {
  it("is a Delete to each recipient, from the sender, when the author deletes it", async () => {
    const { device, planId } = await setup();
    await addContribution(deps, { planId, deviceToken: device, body: "Oops", linkUrl: "" });
    const [contribution] = await contributionsOf(planId);
    const notes = await contributionNotes().listByPlan(planId);
    publisher.sent.length = 0;
    await deleteContribution(deps, {
      planId,
      contributionId: contribution?.id ?? "",
      deviceToken: device,
    });
    expect(sorted(sentDeletes())).toEqual(["delete ben", "delete cat"]);
    expect(
      new Set(deletesOf().map((s) => (s.kind === "contributionNoteDelete" ? s.noteId : ""))),
    ).toEqual(new Set(notes.map((note) => note.noteId)));
    for (const sent of deletesOf())
      expect(sent).toMatchObject({ planId, localActor: INSTANCE_ACTOR });
    expect(await contributionNotes().listByPlan(planId)).toEqual([]);
  });

  it("is a Delete when the host hides it, and a new Note when the host shows it again", async () => {
    const { device, planId, wanda } = await setup();
    await addContribution(deps, { planId, deviceToken: wanda.device, body: "Spicy", linkUrl: "" });
    const [contribution] = await contributionsOf(planId);
    const before = (await contributionNotes().listByPlan(planId)).map((note) => note.noteId);
    const by = { planId, contributionId: contribution?.id ?? "", deviceToken: device };
    publisher.sent.length = 0;

    await setContributionHidden(deps, { ...by, hidden: true });
    expect(sorted(sentDeletes())).toEqual(["delete ben", "delete cat"]);
    expect(await contributionNotes().listByPlan(planId)).toEqual([]);

    publisher.sent.length = 0;
    await setContributionHidden(deps, { ...by, hidden: false });
    expect(sorted(sentNotes())).toEqual(["create ben: Spicy", "create cat: Spicy"]);
    const after = (await contributionNotes().listByPlan(planId)).map((note) => note.noteId);
    expect(after).toHaveLength(2);
    // A new Note: servers may refuse an object again after its Delete.
    for (const id of after) expect(before).not.toContain(id);
  });

  it("changes nothing when the host hides a contribution already hidden, or shows one that is shown", async () => {
    const { device, planId } = await setup();
    await addContribution(deps, { planId, deviceToken: device, body: "Plain", linkUrl: "" });
    const [contribution] = await contributionsOf(planId);
    publisher.sent.length = 0;
    await setContributionHidden(deps, {
      planId,
      contributionId: contribution?.id ?? "",
      deviceToken: device,
      hidden: false,
    });
    expect(publisher.sent).toEqual([]);
  });

  it("is a Delete for every contribution when the host deletes the recap", async () => {
    const { device, planId, wanda } = await setup();
    await addContribution(deps, { planId, deviceToken: device, body: "One", linkUrl: "" });
    await addContribution(deps, { planId, deviceToken: wanda.device, body: "Two", linkUrl: "" });
    publisher.sent.length = 0;
    await deleteRecap(deps, { planId, deviceToken: device });
    expect(sentDeletes()).toHaveLength(4);
    expect(await contributionNotes().listByPlan(planId)).toEqual([]);
    expect(await contributionsOf(planId)).toEqual([]);
  });

  it("is not changed by the recap closing: the Notes stay", async () => {
    const { device, planId } = await setup();
    await addContribution(deps, { planId, deviceToken: device, body: "Stays", linkUrl: "" });
    publisher.sent.length = 0;
    clock.set("2026-06-20T06:00:00Z");
    expect(await contributionNotes().listByPlan(planId)).toHaveLength(2);
    expect(publisher.sent).toEqual([]);
  });

  it("is a Delete for a web author's contributions when they withdraw, to every remote participant", async () => {
    const { planId, wanda } = await setup();
    await addContribution(deps, { planId, deviceToken: wanda.device, body: "Mine", linkUrl: "" });
    publisher.sent.length = 0;
    await withdrawMyResponse(deps, { planId, deviceToken: wanda.device });
    expect(sorted(sentDeletes())).toEqual(["delete ben", "delete cat"]);
    expect(await contributionNotes().listByPlan(planId)).toEqual([]);
  });

  it("is a Delete to the others when a remote author leaves, and for what was sent to them", async () => {
    const { device, planId } = await setup();
    await addContribution(deps, { planId, deviceToken: device, body: "For ben", linkUrl: "" });
    await addRemoteContribution(deps, {
      planId,
      actorId: remote("ben").id,
      noteId: "https://social.example/notes/9",
      addressedTo: [INSTANCE_ACTOR],
      body: "From ben",
      linkUrl: "",
    });
    publisher.sent.length = 0;
    await leaveRemote(deps, { planId, actorId: remote("ben").id });
    // Cat's copy of ben's contribution, and the host's contribution sent to ben.
    expect(sorted(sentDeletes())).toEqual(["delete ben", "delete cat"]);
    // Only cat's copy of the host's contribution is left.
    expect((await contributionNotes().listByPlan(planId)).map((note) => note.responseId)).toEqual([
      await idOf(planId, "cat"),
    ]);
    expect((await contributionsOf(planId)).map((c) => c.body)).toEqual(["For ben"]);
  });

  it("is a Delete of what the participant authored when the host removes them, and of what they received", async () => {
    const { device, planId } = await setup();
    await addContribution(deps, { planId, deviceToken: device, body: "For all", linkUrl: "" });
    await addRemoteContribution(deps, {
      planId,
      actorId: remote("ben").id,
      noteId: "https://social.example/notes/9",
      addressedTo: [INSTANCE_ACTOR],
      body: "From ben",
      linkUrl: "",
    });
    publisher.sent.length = 0;
    await removePerson(deps, {
      planId,
      deviceToken: device,
      responseId: await idOf(planId, "ben"),
    });
    expect(sorted(sentDeletes())).toEqual(["delete ben", "delete cat"]);
    expect((await contributionsOf(planId)).map((c) => c.body)).toEqual(["For all"]);
    // Only cat still has a Note, of the host's contribution.
    expect((await contributionNotes().listByPlan(planId)).map((note) => note.responseId)).toEqual([
      await idOf(planId, "cat"),
    ]);
  });

  it("is a Delete to the participants when the actor of an author deletes itself", async () => {
    const { planId } = await setup();
    await addRemoteContribution(deps, {
      planId,
      actorId: remote("ben").id,
      noteId: "https://social.example/notes/9",
      addressedTo: [INSTANCE_ACTOR],
      body: "From ben",
      linkUrl: "",
    });
    publisher.sent.length = 0;
    await forgetRemoteParticipant(deps, remote("ben").id);
    expect(sentDeletes()).toEqual(["delete cat"]);
    expect(await contributionsOf(planId)).toEqual([]);
  });

  it("is a Delete of every contribution when the deleting device's own data goes", async () => {
    const created = await createPlan(deps, {
      input: { ...sampleInput },
      units: "metric",
      language: "en",
      creationNonce: nonce(),
      deviceToken: undefined,
    });
    if (created.kind !== "created") throw new Error("not created");
    await join(created.planId, remote("fox", "one.example"));
    startRecap();
    await addContribution(deps, {
      planId: created.planId,
      deviceToken: created.newDeviceToken,
      body: "Mine",
      linkUrl: "",
    });
    publisher.sent.length = 0;
    await deleteMyData(deps, { deviceToken: created.newDeviceToken });
    expect(sentDeletes()).toEqual(["delete fox"]);
  });
});

describe("a participant who stops being joined", () => {
  it("stops receiving: a Delete for every Note sent to them, and none for the others", async () => {
    const { device, planId } = await setup();
    await addContribution(deps, { planId, deviceToken: device, body: "One", linkUrl: "" });
    await addContribution(deps, { planId, deviceToken: device, body: "Two", linkUrl: "" });
    publisher.sent.length = 0;
    await beforeStart(() => join(planId, remote("ben"), "tentative", 2));
    expect(sentDeletes()).toEqual(["delete ben", "delete ben"]);
    expect(await contributionNotes().listByRecipient(await idOf(planId, "ben"))).toEqual([]);
    expect(await contributionNotes().listByRecipient(await idOf(planId, "cat"))).toHaveLength(2);
  });

  it("keeps the Notes of what they wrote when they change to interested, as the web keeps it", async () => {
    const { device, planId, wanda } = await setup();
    await addRemoteContribution(deps, {
      planId,
      actorId: remote("ben").id,
      noteId: "https://social.example/notes/9",
      addressedTo: [INSTANCE_ACTOR],
      body: "Ben was here",
      linkUrl: "",
    });
    await addContribution(deps, { planId, deviceToken: device, body: "Host", linkUrl: "" });
    publisher.sent.length = 0;
    await beforeStart(() => join(planId, remote("ben"), "tentative", 2));
    // What was sent to ben goes; cat keeps ben's contribution, which the web still shows.
    expect(sentDeletes()).toEqual(["delete ben"]);
    expect((await contributionsOf(planId)).map((c) => c.body)).toContain("Ben was here");
    expect(
      (await contributionNotes().listByRecipient(await idOf(planId, "cat"))).map(
        (note) => note.contributionId,
      ),
    ).toHaveLength(2);
    // A web participant changing to interested keeps theirs too.
    await addContribution(deps, { planId, deviceToken: wanda.device, body: "Wanda", linkUrl: "" });
    publisher.sent.length = 0;
    await beforeStart(() =>
      updateMyResponse(deps, {
        planId,
        deviceToken: wanda.device,
        choice: "interested",
        displayName: "Wanda",
      }),
    );
    expect(publisher.sent).toEqual([]);
    expect(
      (await contributionsOf(planId)).filter((c) => c.responseId === wanda.responseId),
    ).toHaveLength(1);
  });

  it("gets no more Notes once interested, and a Delete when the participant is rejected after joining", async () => {
    const { device, planId } = await setup();
    await addContribution(deps, { planId, deviceToken: device, body: "One", linkUrl: "" });
    await beforeStart(() => join(planId, remote("ben"), "tentative", 2));
    publisher.sent.length = 0;
    await addContribution(deps, { planId, deviceToken: device, body: "Two", linkUrl: "" });
    expect(sentNotes()).toEqual(["create cat: Two"]);
    // Rejecting a joined participant sends their Notes' Deletes, like a removal.
    publisher.sent.length = 0;
    await removePerson(deps, {
      planId,
      deviceToken: device,
      responseId: await idOf(planId, "cat"),
    });
    expect(sentDeletes()).toEqual(["delete cat", "delete cat"]);
  });
});

describe("a participant who joins late", () => {
  async function withContributions(count: number) {
    const device = await logIn();
    const planId = await plan(device);
    // Web participants write, 20 each at most.
    const authors = [
      { device },
      ...(await Promise.all(["Al", "Bo", "Cy"].map((m) => web(planId, m)))),
    ];
    startRecap();
    for (let i = 0; i < count; i++) {
      clock.set(new Date(Date.parse(STARTED) + i * 1000).toISOString());
      await addContribution(deps, {
        planId,
        deviceToken: authors[i % authors.length]?.device,
        body: `Comment ${String(i).padStart(2, "0")}`,
        linkUrl: "",
      });
    }
    return { device, planId };
  }

  it("receives the visible contributions as direct Notes, oldest first, from the sender at that moment", async () => {
    const { device, planId } = await withContributions(5);
    const [first] = await contributionsOf(planId);
    await setContributionHidden(deps, {
      planId,
      contributionId: first?.id ?? "",
      deviceToken: device,
      hidden: true,
    });
    // Joined before the start, removed and restored after it: back to joined, with the recap.
    clock.set(fixtureNow.toISOString());
    await join(planId, remote("late"));
    clock.set(STARTED);
    await removePerson(deps, {
      planId,
      deviceToken: device,
      responseId: await idOf(planId, "late"),
    });
    publisher.sent.length = 0;
    await restorePerson(deps, {
      planId,
      deviceToken: device,
      responseId: await idOf(planId, "late"),
    });
    expect(sentNotes()).toEqual([
      "create late: Comment 01",
      "create late: Comment 02",
      "create late: Comment 03",
      "create late: Comment 04",
    ]);
  });

  it("gets only the newest 50 of 60, oldest first", async () => {
    const { device, planId } = await withContributions(60);
    expect(await contributionsOf(planId)).toHaveLength(60);
    clock.set(fixtureNow.toISOString());
    await join(planId, remote("late"));
    clock.set(STARTED);
    await removePerson(deps, {
      planId,
      deviceToken: device,
      responseId: await idOf(planId, "late"),
    });
    publisher.sent.length = 0;
    await restorePerson(deps, {
      planId,
      deviceToken: device,
      responseId: await idOf(planId, "late"),
    });
    const sent = sentNotes();
    expect(sent).toHaveLength(50);
    expect(sent[0]).toBe("create late: Comment 10");
    expect(sent.at(-1)).toBe("create late: Comment 59");
    expect(sent).toEqual([...sent].sort((a, b) => a.localeCompare(b)));
  });

  it("is not sent their own contributions", async () => {
    const device = await logIn();
    const planId = await plan(device);
    await join(planId, remote("late"));
    deps = { ...deps, posterActors: { ...deps.posterActors!, enabled: false } };
    startRecap();
    for (const body of ["One", "Two"]) {
      await addContribution(deps, { planId, deviceToken: device, body, linkUrl: "" });
    }
    deps = { ...deps, posterActors: { ...deps.posterActors!, enabled: true } };
    await addRemoteContribution(deps, {
      planId,
      actorId: remote("late").id,
      noteId: "https://social.example/notes/late",
      addressedTo: [INSTANCE_ACTOR],
      body: "From late",
      linkUrl: "",
    });
    publisher.sent.length = 0;
    clock.set(fixtureNow.toISOString());
    await join(planId, remote("late"), "join", 2);
    clock.set(STARTED);
    await join(planId, remote("late"), "join", 3);
    expect(sentNotes()).toEqual(["create late: One", "create late: Two"]);
  });

  it("gets them when accepted while federation was off, on their next Join", async () => {
    const device = await logIn();
    const planId = await plan(device);
    deps = { ...deps, posterActors: { ...deps.posterActors!, enabled: false } };
    await join(planId, remote("off"));
    startRecap();
    await addContribution(deps, { planId, deviceToken: device, body: "While off", linkUrl: "" });
    expect(publisher.sent).toEqual([]);
    deps = { ...deps, posterActors: { ...deps.posterActors!, enabled: true } };
    clock.set(fixtureNow.toISOString());
    await join(planId, remote("off"));
    expect(sentNotes()).toEqual([]);
    clock.set(STARTED);
    await join(planId, remote("off"), "join", 2);
    expect(sentNotes()).toEqual(["create off: While off"]);
  });
});

describe("cancelling the plan", () => {
  it("is a Delete for every contribution Note, as the web hides the recap", async () => {
    const device = await logIn();
    const planId = await plan(device);
    const ben = await (async () => {
      await join(planId, remote("ben"));
      return await idOf(planId, "ben");
    })();
    // A contribution cannot exist before the start through the web; seeded to prove the hook.
    await deps.recap.create({
      id: "seeded",
      planId,
      responseId: undefined,
      body: "Seeded",
      linkUrl: undefined,
      hiddenByHost: false,
      createdAt: clock.now(),
      updatedAt: clock.now(),
    });
    await contributionNotes().create(
      {
        noteId: "seeded-note",
        contributionId: "seeded",
        responseId: ben,
        planId,
        localActor: INSTANCE_ACTOR,
        contentHash: "x",
      },
      clock.now(),
    );
    publisher.sent.length = 0;
    await cancelPlan(deps, { planId, deviceToken: device });
    expect(sentDeletes()).toEqual(["delete ben"]);
    expect(deletesOf()[0]).toMatchObject({ noteId: "seeded-note", planId });
    expect(await contributionNotes().listByPlan(planId)).toEqual([]);
  });
});

describe("on every deletion path, before the plan goes", () => {
  const sampleLater = () =>
    new Date(Date.parse("2026-06-07T05:30:00Z") + 2 * 24 * 60 * 60 * 1000).toISOString();
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
      startRecap();
      await addContribution(deps, { planId, deviceToken: device, body: "Bye", linkUrl: "" });
      expect(sorted(sentNotes())).toEqual(["create cat: Bye", "create dee: Bye"]);
      publisher.sent.length = 0;
      await remove(device, planId);
      expect(await deps.plans.findById(planId)).toBeUndefined();
      expect(sorted(sentDeletes())).toEqual(["delete cat", "delete dee"]);
      // From the actor that sent the Note: a server ignores a Delete from anyone else.
      for (const sent of deletesOf()) expect(sent).toMatchObject({ planId, localActor: sender });
    });
  });
});

describe("the sender of a contribution Note stays the one that sent it (decisions D43, D44)", () => {
  it("Updates and Deletes from the actor that created it, whatever the plan is attributed to later", async () => {
    const device = await logIn();
    await createProfile(deps, { deviceToken: device, handle: "anna" });
    const profileId = (await profiles.findByHandle("anna"))?.id ?? "";
    const planId = await plan(device, { visibility: "public" });
    await join(planId, remote("ben"));
    startRecap();
    await addContribution(deps, { planId, deviceToken: device, body: "Hello", linkUrl: "" });
    const [contribution] = await contributionsOf(planId);
    expect((await contributionNotes().listByPlan(planId))[0]?.localActor).toBe(profileId);
    // Narrowing to link-only withdraws the plan from the profile: attributed to the instance now.
    const current = await stored(planId);
    await deps.plans.update({ ...current, visibility: "link" });
    publisher.sent.length = 0;
    await editContribution(deps, {
      planId,
      contributionId: contribution?.id ?? "",
      deviceToken: device,
      body: "Hello again",
      linkUrl: "",
    });
    expect(publisher.sent[0]).toMatchObject({ kind: "contributionNote", localActor: profileId });
    await deleteContribution(deps, {
      planId,
      contributionId: contribution?.id ?? "",
      deviceToken: device,
    });
    expect(publisher.sent.at(-1)).toMatchObject({
      kind: "contributionNoteDelete",
      localActor: profileId,
    });
  });

  it("falls back to the instance actor once the stored actor can no longer sign", async () => {
    const device = await logIn();
    await createProfile(deps, { deviceToken: device, handle: "anna" });
    const profileId = (await profiles.findByHandle("anna"))?.id ?? "";
    const planId = await plan(device, { visibility: "public" });
    await join(planId, remote("ben"));
    startRecap();
    await addContribution(deps, { planId, deviceToken: device, body: "Hello", linkUrl: "" });
    const [contribution] = await contributionsOf(planId);
    // The actor's keys are gone, without the Notes having been withdrawn first.
    for (const [id, profile] of profiles.profiles) {
      profiles.profiles.set(id, { ...profile, retiredAt: clock.now() });
    }
    publisher.sent.length = 0;
    await deleteContribution(deps, {
      planId,
      contributionId: contribution?.id ?? "",
      deviceToken: device,
    });
    expect(publisher.sent[0]).toMatchObject({
      kind: "contributionNoteDelete",
      localActor: INSTANCE_ACTOR,
    });
    expect(profileId).not.toBe(INSTANCE_ACTOR);
  });

  it("is withdrawn from the profile, key carried, and sent again from the instance, when the profile is turned off", async () => {
    const device = await logIn();
    await createProfile(deps, { deviceToken: device, handle: "anna" });
    const profileId = (await profiles.findByHandle("anna"))?.id ?? "";
    const planId = await plan(device, { visibility: "public" });
    await join(planId, remote("ben"));
    startRecap();
    await addContribution(deps, { planId, deviceToken: device, body: "Kept", linkUrl: "" });
    publisher.sent.length = 0;
    await retireProfile(deps, { deviceToken: device });
    const deletes = deletesOf();
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toMatchObject({ localActor: profileId, carryKey: true, planId });
    const created = publisher.sent.filter((s) => s.kind === "contributionNote");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      activity: "create",
      localActor: INSTANCE_ACTOR,
      to: remote("ben").id,
      note: { body: "Kept" },
    });
    // After the old Note's Delete, with a new identifier.
    const order = publisher.sent.map((s) => s.kind);
    expect(order.indexOf("contributionNoteDelete")).toBeLessThan(order.indexOf("contributionNote"));
    const oldId = deletes[0]?.kind === "contributionNoteDelete" ? deletes[0].noteId : "";
    expect(created[0]?.kind === "contributionNote" ? created[0].note.noteId : oldId).not.toBe(
      oldId,
    );
  });

  it("is withdrawn from the profile, key carried, and not sent again, when the account is deleted", async () => {
    const device = await logIn();
    await createProfile(deps, { deviceToken: device, handle: "anna" });
    const profileId = (await profiles.findByHandle("anna"))?.id ?? "";
    const planId = await plan(device, { visibility: "public" });
    await join(planId, remote("ben"));
    startRecap();
    await addContribution(deps, { planId, deviceToken: device, body: "Gone", linkUrl: "" });
    publisher.sent.length = 0;
    await deleteAccount(deps, { deviceToken: device });
    const deletes = deletesOf();
    expect(deletes.length).toBeGreaterThanOrEqual(1);
    expect(deletes[0]).toMatchObject({ localActor: profileId, carryKey: true });
    expect(sentNotes()).toEqual([]);
  });
});

describe("a Note that is sent once", () => {
  it("is created once, however often the contribution is published", async () => {
    const { device, planId } = await setup();
    await addContribution(deps, { planId, deviceToken: device, body: "Once", linkUrl: "" });
    const [contribution] = await contributionsOf(planId);
    publisher.sent.length = 0;
    // Unhiding a contribution that is not hidden publishes it again: nothing new goes.
    await setContributionHidden(deps, {
      planId,
      contributionId: contribution?.id ?? "",
      deviceToken: device,
      hidden: false,
    });
    expect(sentNotes()).toEqual([]);
    expect(await contributionNotes().listByPlan(planId)).toHaveLength(2);
  });

  it("is withdrawn from the queue first, so a failure to queue loses nothing", async () => {
    const { device, planId } = await setup();
    await addContribution(deps, { planId, deviceToken: device, body: "Keep row", linkUrl: "" });
    const [contribution] = await contributionsOf(planId);
    publisher.withdrawContributionNote = () => Promise.reject(new Error("queue down"));
    await expect(
      deleteContribution(deps, {
        planId,
        contributionId: contribution?.id ?? "",
        deviceToken: device,
      }),
    ).rejects.toThrow("queue down");
    expect(await contributionNotes().listByPlan(planId)).toHaveLength(2);
    expect(await contributionsOf(planId)).toHaveLength(1);
  });
});

describe("a reply from a remote participant (decision D44)", () => {
  const reply = (
    planId: string,
    overrides: Partial<Parameters<typeof addRemoteContribution>[1]> = {},
  ) => ({
    planId,
    actorId: remote("ben").id,
    noteId: "https://social.example/notes/1",
    addressedTo: [INSTANCE_ACTOR],
    body: "Lovely route",
    linkUrl: "",
    ...overrides,
  });

  it("becomes a contribution by their response, shown under their name", async () => {
    const { planId } = await setup();
    expect(await addRemoteContribution(deps, reply(planId))).toBe("added");
    const [contribution] = await contributionsOf(planId);
    expect(contribution).toMatchObject({
      planId,
      responseId: await idOf(planId, "ben"),
      body: "Lovely route",
      linkUrl: undefined,
      hiddenByHost: false,
    });
  });

  it("splits a link and keeps the validation of the web: empty, too long and bad links are ignored", async () => {
    const { planId } = await setup();
    expect(
      await addRemoteContribution(
        deps,
        reply(planId, {
          noteId: "https://social.example/notes/a",
          body: "",
          linkUrl: "https://t.example/x",
        }),
      ),
    ).toBe("added");
    expect(
      await addRemoteContribution(
        deps,
        reply(planId, { noteId: "https://social.example/notes/b", body: "  ", linkUrl: "" }),
      ),
    ).toBe("ignored");
    expect(
      await addRemoteContribution(
        deps,
        reply(planId, {
          noteId: "https://social.example/notes/c",
          body: "x".repeat(CONTRIBUTION_LIMITS.body + 1),
        }),
      ),
    ).toBe("ignored");
    expect(
      await addRemoteContribution(
        deps,
        reply(planId, {
          noteId: "https://social.example/notes/d",
          body: "ok",
          linkUrl: `https://t.example/${"y".repeat(CONTRIBUTION_LIMITS.linkUrl)}`,
        }),
      ),
    ).toBe("ignored");
    expect(
      await addRemoteContribution(
        deps,
        reply(planId, {
          noteId: "https://social.example/notes/e",
          body: "ok",
          linkUrl: "ftp://t.example/x",
        }),
      ),
    ).toBe("ignored");
    expect(await contributionsOf(planId)).toHaveLength(1);
    expect(
      await addRemoteContribution(
        deps,
        reply(planId, {
          noteId: "https://social.example/notes/f",
          body: "y".repeat(CONTRIBUTION_LIMITS.body),
        }),
      ),
    ).toBe("added");
  });

  it("stops at the usual 20 per person", async () => {
    const { planId } = await setup();
    for (let i = 0; i < CONTRIBUTION_LIMITS.perPerson; i++) {
      expect(
        await addRemoteContribution(
          deps,
          reply(planId, { noteId: `https://social.example/notes/${i}`, body: `n${i}` }),
        ),
      ).toBe("added");
    }
    expect(
      await addRemoteContribution(
        deps,
        reply(planId, { noteId: "https://social.example/notes/over", body: "one more" }),
      ),
    ).toBe("ignored");
    expect(await contributionsOf(planId)).toHaveLength(CONTRIBUTION_LIMITS.perPerson);
  });

  it("is idempotent: the same Note twice is one contribution, and one fan-out", async () => {
    const { planId } = await setup();
    expect(await addRemoteContribution(deps, reply(planId))).toBe("added");
    publisher.sent.length = 0;
    expect(await addRemoteContribution(deps, reply(planId))).toBe("ignored");
    expect(await contributionsOf(planId)).toHaveLength(1);
    expect(publisher.sent).toEqual([]);
  });

  it("is ignored from anyone who has not joined, and from an unknown actor", async () => {
    const device = await logIn();
    const planId = await plan(device, { joinMode: "approval" });
    await join(planId, remote("ida"), "tentative");
    await join(planId, remote("rae"));
    await join(planId, remote("rob"));
    await rejectRequest(deps, {
      planId,
      deviceToken: device,
      responseId: await idOf(planId, "rob"),
    });
    await join(planId, remote("sam"));
    await acceptRequest(deps, {
      planId,
      deviceToken: device,
      responseId: await idOf(planId, "sam"),
    });
    await removePerson(deps, {
      planId,
      deviceToken: device,
      responseId: await idOf(planId, "sam"),
    });
    startRecap();
    for (const name of ["ida", "rae", "rob", "sam", "nobody"]) {
      expect(
        await addRemoteContribution(deps, {
          ...reply(planId),
          actorId: remote(name).id,
          noteId: `https://social.example/notes/${name}`,
        }),
      ).toBe("ignored");
    }
    expect(await contributionsOf(planId)).toEqual([]);
  });

  it("is ignored when the recap is not open: before the start, closed, or cancelled", async () => {
    const device = await logIn();
    const planId = await plan(device);
    const cancelledId = await plan(device, { title: "Other" });
    await join(planId, remote("ben"));
    await join(cancelledId, remote("ben"));
    await cancelPlan(deps, { planId: cancelledId, deviceToken: device });
    expect(await addRemoteContribution(deps, reply(planId))).toBe("ignored");
    clock.set("2026-06-20T06:00:00Z");
    expect(await addRemoteContribution(deps, reply(planId))).toBe("ignored");
    clock.set(STARTED);
    expect(await addRemoteContribution(deps, reply(cancelledId))).toBe("ignored");
    expect(await contributionsOf(planId)).toEqual([]);
    expect(await contributionsOf(cancelledId)).toEqual([]);
  });

  it("is ignored when not addressed privately to one of our actors", async () => {
    const { planId } = await setup();
    const other = "someone-elses-actor";
    for (const [i, addressedTo] of [
      [],
      [INSTANCE_ACTOR, other],
      [other],
      [INSTANCE_ACTOR, "x/followers"],
    ].entries()) {
      expect(
        await addRemoteContribution(
          deps,
          reply(planId, { noteId: `https://social.example/notes/${i}`, addressedTo }),
        ),
      ).toBe("ignored");
    }
    expect(await contributionsOf(planId)).toEqual([]);
  });

  it("is accepted when addressed to the actor that sent them Notes, even after the plan changed hands", async () => {
    const device = await logIn();
    await createProfile(deps, { deviceToken: device, handle: "anna" });
    const profileId = (await profiles.findByHandle("anna"))?.id ?? "";
    const planId = await plan(device, { visibility: "public" });
    await join(planId, remote("ben"));
    startRecap();
    expect(await addRemoteContribution(deps, reply(planId, { addressedTo: [profileId] }))).toBe(
      "added",
    );
    expect(
      await addRemoteContribution(
        deps,
        reply(planId, { noteId: "https://social.example/notes/2", addressedTo: ["unknown-actor"] }),
      ),
    ).toBe("ignored");
  });

  it("is fanned out to the other participants, never back to the author", async () => {
    const { planId } = await setup();
    await beforeStart(() => join(planId, remote("dan", "third.example")));
    publisher.sent.length = 0;
    await addRemoteContribution(deps, reply(planId));
    expect(sorted(sentNotes())).toEqual(["create cat: Lovely route", "create dan: Lovely route"]);
    expect(sentNotes().some((sent) => sent.includes("ben"))).toBe(false);
  });

  it("is edited only by its own author, only while they are joined and the recap open", async () => {
    const { planId } = await setup();
    await addRemoteContribution(deps, reply(planId));
    publisher.sent.length = 0;
    const edit = (overrides: Partial<Parameters<typeof editRemoteContribution>[1]> = {}) =>
      editRemoteContribution(deps, { ...reply(planId), body: "Changed", ...overrides });
    // Someone else's Update of ben's Note.
    expect(await edit({ actorId: remote("cat", "other.example").id })).toBe("ignored");
    expect((await contributionsOf(planId))[0]?.body).toBe("Lovely route");
    expect(publisher.sent).toEqual([]);
    // Publicly addressed.
    expect(await edit({ addressedTo: [] })).toBe("ignored");
    // The author's own.
    expect(await edit()).toBe("updated");
    expect((await contributionsOf(planId))[0]?.body).toBe("Changed");
    expect(sentNotes()).toEqual(["update cat: Changed"]);
    // Invalid content changes nothing.
    expect(await edit({ body: "", linkUrl: "" })).toBe("ignored");
    expect((await contributionsOf(planId))[0]?.body).toBe("Changed");
    // After the recap closed.
    clock.set("2026-06-20T06:00:00Z");
    expect(await edit({ body: "Too late" })).toBe("ignored");
    expect((await contributionsOf(planId))[0]?.body).toBe("Changed");
  });

  it("is not edited by an author who is no longer joined", async () => {
    const { planId } = await setup();
    await addRemoteContribution(deps, reply(planId));
    await beforeStart(() => join(planId, remote("ben"), "tentative", 2));
    expect(await editRemoteContribution(deps, { ...reply(planId), body: "Sneaky" })).toBe(
      "ignored",
    );
    expect((await contributionsOf(planId))[0]?.body).toBe("Lovely route");
  });

  it("is deleted by its author's Delete, with a Delete to the others; nobody else's does", async () => {
    const { planId } = await setup();
    await addRemoteContribution(deps, reply(planId));
    publisher.sent.length = 0;
    expect(
      await deleteRemoteContribution(deps, {
        actorId: remote("cat", "other.example").id,
        noteId: "https://social.example/notes/1",
      }),
    ).toBe("ignored");
    expect(await contributionsOf(planId)).toHaveLength(1);
    expect(
      await deleteRemoteContribution(deps, {
        actorId: remote("ben").id,
        noteId: "https://social.example/notes/unknown",
      }),
    ).toBe("ignored");
    expect(publisher.sent).toEqual([]);
    expect(
      await deleteRemoteContribution(deps, {
        actorId: remote("ben").id,
        noteId: "https://social.example/notes/1",
      }),
    ).toBe("deleted");
    expect(await contributionsOf(planId)).toEqual([]);
    expect(sentDeletes()).toEqual(["delete cat"]);
    expect(await contributionNotes().listByPlan(planId)).toEqual([]);
  });

  it("changes nothing while federation is off", async () => {
    const { planId } = await setup();
    deps = { ...deps, posterActors: { ...deps.posterActors!, enabled: false } };
    expect(await addRemoteContribution(deps, reply(planId))).toBe("ignored");
    expect(await contributionsOf(planId)).toEqual([]);
  });
});

/** The target of a reply and the quota hook, as the inbox passes them (review of step 12a). */
describe("a reply to one of our Notes (decision D44, review of 12a)", () => {
  const participantNotes = () => deps.posterActors!.notes as FakeParticipantNotes;
  const servers: Record<string, string> = { cat: "other.example", mallory: "evil.example" };
  const actorOf = (name: string) => remote(name, servers[name] ?? "social.example");
  const request = (
    actor: string,
    target: { planId: string } | { ourNoteId: string },
    overrides: Partial<Parameters<typeof addRemoteContribution>[1]> = {},
  ) =>
    ({
      ...target,
      actorId: actorOf(actor).id,
      noteId: `https://social.example/notes/${actor}-reply`,
      addressedTo: [INSTANCE_ACTOR],
      body: `${actor} answers`,
      linkUrl: "",
      ...overrides,
    }) as Parameters<typeof addRemoteContribution>[1];

  /** Ben, Cat and Mallory joined remotely; Wanda wrote the comment that went to all three. */
  async function withNotes() {
    const { device, planId, wanda } = await setup();
    await beforeStart(() => join(planId, remote("mallory", "evil.example")));
    await addContribution(deps, { planId, deviceToken: wanda.device, body: "Spicy", linkUrl: "" });
    const noteTo = async (name: string) =>
      (await contributionNotes().listByRecipient(await idOf(planId, name)))[0]?.noteId ?? "";
    return { device, planId, wanda, noteTo };
  }

  it("is a comment on the plan of the contribution Note, when its recipient answers", async () => {
    const { planId, noteTo } = await withNotes();
    expect(
      await addRemoteContribution(deps, request("ben", { ourNoteId: await noteTo("ben") })),
    ).toBe("added");
    const mine = (await contributionsOf(planId)).filter((c) => c.body === "ben answers");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ planId, responseId: await idOf(planId, "ben") });
  });

  it("is a comment too when it answers the Note with the exact start", async () => {
    const { planId } = await withNotes();
    const benId = await idOf(planId, "ben");
    const exactStartNote = await participantNotes().find(benId);
    expect(exactStartNote).toBeDefined();
    expect(
      await addRemoteContribution(
        deps,
        request(
          "ben",
          { ourNoteId: exactStartNote?.noteId ?? "" },
          { body: "See you at the start" },
        ),
      ),
    ).toBe("added");
    expect((await contributionsOf(planId)).map((c) => c.body)).toContain("See you at the start");
  });

  it("is ignored from any other joined participant, whose own Note is the only one they may answer", async () => {
    const { planId, noteTo } = await withNotes();
    const before = (await contributionsOf(planId)).length;
    const admitted: string[] = [];
    const admit = () => (admitted.push("token"), true);
    for (const name of ["mallory", "cat"]) {
      expect(
        await addRemoteContribution(
          deps,
          request(name, { ourNoteId: await noteTo("ben") }, { admit }),
        ),
      ).toBe("ignored");
    }
    expect(await contributionsOf(planId)).toHaveLength(before);
    expect(admitted).toEqual([]);
    // The same people may answer the Note sent to themselves.
    expect(
      await addRemoteContribution(deps, request("mallory", { ourNoteId: await noteTo("mallory") })),
    ).toBe("added");
  });

  it("is ignored once the recipient no longer is joined, whether or not their Note row is still there", async () => {
    const { planId, noteTo } = await withNotes();
    const benNote = await noteTo("ben");
    const row = await contributionNotes().find(
      (await contributionNotes().listByRecipient(await idOf(planId, "ben")))[0]?.contributionId ??
        "",
      await idOf(planId, "ben"),
    );
    await beforeStart(() => join(planId, remote("ben"), "tentative", 2));
    const before = (await contributionsOf(planId)).length;
    // The Notes were withdrawn with the answer: the identifier is unknown now.
    expect(await addRemoteContribution(deps, request("ben", { ourNoteId: benNote }))).toBe(
      "ignored",
    );
    // A row that survived (a race) does not make an interested person a commenter.
    await contributionNotes().create(
      {
        noteId: "survivor",
        contributionId: row?.contributionId ?? "",
        responseId: row?.responseId ?? "",
        planId,
        localActor: row?.localActor ?? "",
        contentHash: "x",
      },
      clock.now(),
    );
    expect(await addRemoteContribution(deps, request("ben", { ourNoteId: "survivor" }))).toBe(
      "ignored",
    );
    expect(await contributionsOf(planId)).toHaveLength(before);
  });

  it("is ignored for an identifier that is none of our Notes", async () => {
    const { planId } = await withNotes();
    const before = (await contributionsOf(planId)).length;
    expect(await addRemoteContribution(deps, request("ben", { ourNoteId: "no-such-note" }))).toBe(
      "ignored",
    );
    expect(await contributionsOf(planId)).toHaveLength(before);
  });

  it("belongs to the plan of the Note, never to another plan the participant joined", async () => {
    const { device, planId, noteTo } = await withNotes();
    const other = await beforeStart(async () => {
      const id = await plan(device, { title: "Plan B" });
      await join(id, remote("ben"), "join", 2);
      return id;
    });
    expect(
      await addRemoteContribution(deps, request("ben", { ourNoteId: await noteTo("ben") })),
    ).toBe("added");
    expect((await contributionsOf(other)).map((c) => c.body)).toEqual([]);
    expect((await contributionsOf(planId)).map((c) => c.body)).toContain("ben answers");
  });

  it("is edited by the recipient's Update of that reply, and by no other participant", async () => {
    const { planId, noteTo } = await withNotes();
    const target = { ourNoteId: await noteTo("ben") };
    await addRemoteContribution(deps, request("ben", target));
    const edit = (name: string) =>
      editRemoteContribution(deps, {
        ...request(name, target, { body: "Edited" }),
        noteId: "https://social.example/notes/ben-reply",
      });
    expect(await edit("mallory")).toBe("ignored");
    expect(await edit("ben")).toBe("updated");
    expect((await contributionsOf(planId)).map((c) => c.body)).toContain("Edited");
  });
});

describe("the reply quota is taken last (review of 12a)", () => {
  const request = (overrides: Partial<Parameters<typeof addRemoteContribution>[1]> = {}) =>
    ({
      planId: "",
      actorId: remote("ben").id,
      noteId: "https://social.example/notes/q1",
      addressedTo: [INSTANCE_ACTOR],
      body: "Quota words",
      linkUrl: "",
      ...overrides,
    }) as Parameters<typeof addRemoteContribution>[1];

  it("is spent by a plausible reply only, not by anything that is simply not for us", async () => {
    const { planId } = await setup();
    const taken: number[] = [];
    const admit = () => (taken.push(1), true);
    const ignored = [
      request({ planId, admit, actorId: remote("nobody").id }),
      request({ planId, admit, addressedTo: [] }),
      request({ planId, admit, addressedTo: ["someone-else"] }),
      request({ planId, admit, body: "", linkUrl: "" }),
      request({ planId, admit, body: "x".repeat(1001) }),
      request({ planId: "no-such-plan", admit }),
      { ...request({ admit }), planId: undefined, ourNoteId: "no-such-note" },
    ] as Parameters<typeof addRemoteContribution>[1][];
    const results: string[] = [];
    for (const one of ignored) results.push(await addRemoteContribution(deps, one));
    expect(results).toEqual(Array<string>(ignored.length).fill("ignored"));
    expect(taken).toEqual([]);
    // Before the start the recap is not open: not for us yet either.
    clock.set(fixtureNow.toISOString());
    expect(await addRemoteContribution(deps, request({ planId, admit }))).toBe("ignored");
    expect(taken).toEqual([]);
    startRecap();
    expect(await addRemoteContribution(deps, request({ planId, admit }))).toBe("added");
    expect(taken).toEqual([1]);
    // The same Note again is not plausible either: nothing new, no token.
    expect(await addRemoteContribution(deps, request({ planId, admit }))).toBe("ignored");
    expect(taken).toEqual([1]);
  });

  it("is refused for a plausible reply over the limit, storing nothing, for edits as well", async () => {
    const { planId } = await setup();
    expect(await addRemoteContribution(deps, request({ planId, admit: () => false }))).toBe(
      "limited",
    );
    expect(await contributionsOf(planId)).toEqual([]);
    expect(await addRemoteContribution(deps, request({ planId }))).toBe("added");
    expect(
      await editRemoteContribution(deps, request({ planId, body: "Edit", admit: () => false })),
    ).toBe("limited");
    expect((await contributionsOf(planId)).map((c) => c.body)).toEqual(["Quota words"]);
    const taken: number[] = [];
    // An edit of something that is not ours spends nothing.
    expect(
      await editRemoteContribution(
        deps,
        request({
          planId,
          noteId: "https://social.example/notes/unknown",
          admit: () => (taken.push(1), true),
        }),
      ),
    ).toBe("ignored");
    expect(taken).toEqual([]);
  });
});

describe("a reply that loses the race to its own mapping (review of 12a)", () => {
  it("withdraws the Notes a concurrent publish sent for it before it is deleted", async () => {
    const { planId } = await setup();
    const real = deps.posterActors!.remoteContributions!;
    // Another attempt stores the mapping first, and meanwhile the contribution was published.
    deps.posterActors!.remoteContributions = {
      findContribution: (responseId, remoteNoteId) =>
        real.findContribution(responseId, remoteNoteId),
      async create() {
        const [loser] = await contributionsOf(planId);
        const found = await stored(planId);
        await publishContribution(deps, found, loser?.id ?? "");
        return false;
      },
    };
    publisher.sent.length = 0;
    expect(
      await addRemoteContribution(deps, {
        planId,
        actorId: remote("ben").id,
        noteId: "https://social.example/notes/raced",
        addressedTo: [INSTANCE_ACTOR],
        body: "Raced",
        linkUrl: "",
      }),
    ).toBe("ignored");
    expect(sentNotes()).toEqual(["create cat: Raced"]);
    expect(sentDeletes()).toEqual(["delete cat"]);
    expect(await contributionsOf(planId)).toEqual([]);
    expect(await contributionNotes().listByPlan(planId)).toEqual([]);
  });
});

describe("hiding a contribution (review of 12a)", () => {
  it("stores the hidden flag before the Notes are withdrawn, so no publish can send one in between", async () => {
    const { device, planId, wanda } = await setup();
    await addContribution(deps, { planId, deviceToken: wanda.device, body: "Hush", linkUrl: "" });
    const [contribution] = await contributionsOf(planId);
    const seen: (boolean | undefined)[] = [];
    const original = publisher.withdrawContributionNote.bind(publisher);
    publisher.withdrawContributionNote = async (...args) => {
      seen.push((await deps.recap.findById(contribution?.id ?? ""))?.hiddenByHost);
      return original(...args);
    };
    await setContributionHidden(deps, {
      planId,
      contributionId: contribution?.id ?? "",
      deviceToken: device,
      hidden: true,
    });
    expect(seen).toEqual([true, true]);
    expect(await contributionNotes().listByPlan(planId)).toEqual([]);
    // And shown again, the Notes come back.
    await setContributionHidden(deps, {
      planId,
      contributionId: contribution?.id ?? "",
      deviceToken: device,
      hidden: false,
    });
    expect(await contributionNotes().listByPlan(planId)).toHaveLength(2);
  });
});

describe("an edit while the host hides a contribution (re-review of 12a)", () => {
  it("sends no Update for the hidden contribution, and Updates again once it is shown", async () => {
    const { device, planId, wanda } = await setup();
    await addContribution(deps, { planId, deviceToken: wanda.device, body: "Draft", linkUrl: "" });
    const [contribution] = await contributionsOf(planId);
    const by = { planId, contributionId: contribution?.id ?? "" };
    const edit = (body: string) =>
      editContribution(deps, { ...by, deviceToken: wanda.device, body, linkUrl: "" });
    const original = publisher.withdrawContributionNote.bind(publisher);
    let editedDuring = false;
    publisher.withdrawContributionNote = async (...args) => {
      // The flag is stored, the Notes are not yet withdrawn: the author edits right now.
      if (!editedDuring) {
        editedDuring = true;
        await edit("Edited while hiding");
      }
      return original(...args);
    };
    publisher.sent.length = 0;
    await setContributionHidden(deps, { ...by, deviceToken: device, hidden: true });
    expect(editedDuring).toBe(true);
    expect(sentNotes().filter((sent) => sent.startsWith("update"))).toEqual([]);
    // Shown again: the Notes are new, and a later edit is an Update of them.
    await setContributionHidden(deps, { ...by, deviceToken: device, hidden: false });
    publisher.sent.length = 0;
    await edit("Edited after");
    expect(sorted(sentNotes())).toEqual(["update ben: Edited after", "update cat: Edited after"]);
  });
});

describe("the cap of replies per person (review of 12a)", () => {
  it("holds when many replies of one author arrive at once", async () => {
    const { planId } = await setup();
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, k) =>
        addRemoteContribution(deps, {
          planId,
          actorId: remote("ben").id,
          noteId: `https://social.example/notes/burst-${k}`,
          addressedTo: [INSTANCE_ACTOR],
          body: `Burst ${k}`,
          linkUrl: "",
        }),
      ),
    );
    expect(results.filter((result) => result === "added")).toHaveLength(
      CONTRIBUTION_LIMITS.perPerson,
    );
    expect(await deps.recap.countByAuthor(planId, await idOf(planId, "ben"))).toBe(
      CONTRIBUTION_LIMITS.perPerson,
    );
  });
});
