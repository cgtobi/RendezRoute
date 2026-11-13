// A poster's fediverse profile (spec 7 ActivityPub; decisions D35, D36, D37; plan v1.0 step 9b):
// the handle chosen once, followers plans only with a profile, plans shared from when they are
// saved under the fediverse wording, and turning off (or deleting the account) retiring the handle.
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { deleteAccount, expireAccounts } from "../../src/application/account-data.ts";
import { deletePlanAsAdmin } from "../../src/application/admin.ts";
import { FakeAdminAuth } from "../fakes/admin-auth.ts";
import { type AccountDeps, finishLogin, startLogin } from "../../src/application/accounts.ts";
import {
  createProfile,
  planActor,
  posterActor,
  posterActorFor,
  profileSetting,
  retireProfile,
  viewProfilePage,
} from "../../src/application/fediverse-profile.ts";
import {
  followActor,
  forgetFollowersWhileOff,
  forgetRemoteActor,
  INSTANCE_ACTOR,
  unfollowActor,
} from "../../src/application/following.ts";
import { cancelPlan, deletePlan, editPlan, viewHostPage } from "../../src/application/host.ts";
import { applyRetentionMax, runRetentionSweep } from "../../src/application/maintenance.ts";
import { setRoute } from "../../src/application/routes.ts";
import { fakeGpx } from "../fakes/route-parser.ts";
import { createPlan } from "../../src/application/plans.ts";
import { visibilityChoices } from "../../src/application/public-plans.ts";
import { repeatTemplate, saveAsTemplate } from "../../src/application/templates.ts";
import type { ProviderAccount } from "../../src/application/ports.ts";
import { planToInput } from "../../src/domain/plan-edit.ts";
import type { PlanInput } from "../../src/domain/plan-input.ts";
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
let actorKeys: FakeActorKeys;
let followers: FakeFollowers;
let publisher: FakePublisher;
let publications: FakePublications;
let clock: FakeClock;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;

beforeEach(() => {
  provider = new FakeIdentityProvider();
  followers = new FakeFollowers();
  profiles = new FakeFediverseProfiles(followers);
  actorKeys = new FakeActorKeys();
  publisher = new FakePublisher();
  publications = new FakePublications();
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
      actorKeys,
      followers,
      publications,
      notes: new FakeParticipantNotes(),
      publisher,
      enabled: true,
    },
    identityLookup: { hash: (value) => `hmac(${value})` },
    identityProviders: { oidc: provider },
    fediverse: { servers: undefined, allowInsecure: false },
  };
});

async function logIn(name = "Anna Müller", subject = "anna"): Promise<string> {
  const account: ProviderAccount = { subject: `https://id.example.org ${subject}`, names: [name] };
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

const withFederation = (enabled: boolean) => {
  deps = { ...deps, posterActors: { ...deps.posterActors!, enabled } };
};

describe("turning the profile on (decision D36)", () => {
  it("is offered to a logged-in account with a handle suggested from the display name", async () => {
    expect(await profileSetting(deps, { deviceToken: undefined })).toEqual({ kind: "unavailable" });
    const device = await logIn();
    expect(await profileSetting(deps, { deviceToken: device })).toEqual({
      kind: "off",
      suggestion: "anna_muller",
    });
    expect(await createProfile(deps, { deviceToken: device, handle: "Anna_M" })).toEqual({
      kind: "created",
      handle: "anna_m",
    });
    expect(await profileSetting(deps, { deviceToken: device })).toEqual({
      kind: "on",
      handle: "anna_m",
      followers: 0,
    });
  });

  it("refuses handles that are malformed, reserved or taken", async () => {
    const anna = await logIn();
    const ben = await logIn("Ben", "ben");
    const create = (deviceToken: string, handle: string) =>
      createProfile(deps, { deviceToken, handle });
    expect(await create(anna, "anna.m")).toEqual({ kind: "invalid", code: "handle_invalid" });
    expect(await create(anna, "admin")).toEqual({ kind: "invalid", code: "handle_reserved" });
    await create(anna, "anna");
    expect(await create(ben, "anna")).toEqual({ kind: "invalid", code: "handle_taken" });
    // One profile per account.
    expect(await create(anna, "anna_2")).toEqual({ kind: "invalid", code: "handle_taken" });
    // Keys are made only for the profile that was created: refusals come first.
    expect(actorKeys.made).toBe(1);
  });

  it("finds a handle in any case, as WebFinger may ask for it", async () => {
    const device = await logIn();
    await createProfile(deps, { deviceToken: device, handle: "anna" });
    expect(await posterActorFor(deps, "Anna")).toBe((await profiles.findByHandle("anna"))?.id);
  });

  it("is not offered while federation is off", async () => {
    const device = await logIn();
    withFederation(false);
    expect(await profileSetting(deps, { deviceToken: device })).toEqual({ kind: "unavailable" });
    expect(await createProfile(deps, { deviceToken: device, handle: "anna" })).toEqual({
      kind: "unavailable",
    });
  });
});

describe("followers and the fediverse wording (decisions D35, D37)", () => {
  it("allows followers only with a profile, and shares public and followers plans from then on", async () => {
    const device = await logIn();
    const before = await plan(device, { visibility: "public" });
    expect(
      await createPlan(deps, {
        input: { ...sampleInput, visibility: "followers" },
        units: "metric",
        language: "en",
        creationNonce: nonce(),
        deviceToken: device,
      }),
    ).toEqual({
      kind: "invalid",
      errors: [{ field: "visibility", code: "followers_needs_profile" }],
    });
    // Public without a profile: listed in Nearby, not shared in the fediverse.
    expect((await stored(before)).federatedAt).toBeUndefined();
    expect(await planActor(deps, await stored(before))).toBeUndefined();

    await createProfile(deps, { deviceToken: device, handle: "anna" });
    const followers = await plan(device, { visibility: "followers" });
    expect((await stored(followers)).federatedAt).toEqual(fixtureNow);
    const actor = (await profiles.findByHandle("anna"))?.id;
    expect(await planActor(deps, await stored(followers))).toBe(actor);
    // The public plan from before is shared once it is saved under the new wording, not sooner.
    expect((await stored(before)).federatedAt).toBeUndefined();
    expect(await planActor(deps, await stored(before))).toBeUndefined();
    later(1);
    await edit(device, before, { title: "Saved again" });
    expect((await stored(before)).federatedAt).toEqual(clock.now());
    // Saving again keeps when it was first shared.
    const firstShared = clock.now();
    later(1);
    await edit(device, before, { title: "Saved once more" });
    expect((await stored(before)).federatedAt).toEqual(firstShared);
    // Narrowed to link-only: not shared any more.
    await edit(device, followers, { visibility: "link" });
    expect((await stored(followers)).federatedAt).toBeUndefined();
  });

  it("repeats a followers template as link-only where the account has no profile", async () => {
    const device = await logIn();
    await createProfile(deps, { deviceToken: device, handle: "anna" });
    const planId = await plan(device, { visibility: "followers" });
    const saved = await saveAsTemplate(deps, {
      planId,
      deviceToken: device,
      includePrivate: false,
      creationNonce: nonce(),
    });
    if (saved.kind !== "saved") throw new Error("not saved");
    await retireProfile(deps, { deviceToken: device });
    const repeated = await repeatTemplate(deps, {
      templateId: saved.templateId,
      deviceToken: device,
      date: "2026-06-14",
      time: "07:30",
      units: "metric",
      creationNonce: nonce(),
    });
    if (repeated.kind !== "created") throw new Error(`repeat failed: ${repeated.kind}`);
    expect(repeated.adjustments).toEqual([{ field: "visibility", from: "followers", to: "link" }]);
    expect((await stored(repeated.planId)).visibility).toBe("link");
  });
});

describe("public plans with Nearby off (decision I59)", () => {
  it("may be chosen only where a profile shares them", async () => {
    deps = { ...deps, publicPlansOffered: false };
    const device = await logIn();
    expect(await visibilityChoices(deps, { deviceToken: device })).toMatchObject({
      publicAllowed: false,
      sharedBy: undefined,
    });
    await createProfile(deps, { deviceToken: device, handle: "anna" });
    expect(await visibilityChoices(deps, { deviceToken: device })).toMatchObject({
      publicAllowed: true,
      sharedBy: "anna",
    });
    const planId = await plan(device, { visibility: "public" });
    expect(await planActor(deps, await stored(planId))).toBe(
      (await profiles.findByHandle("anna"))?.id,
    );
  });
});

describe("federation turned off later (decision I58)", () => {
  it("keeps a followers plan for followers, and when it was first shared, through edits", async () => {
    const device = await logIn();
    await createProfile(deps, { deviceToken: device, handle: "anna" });
    const followers = await plan(device, { visibility: "followers" });
    withFederation(false);
    const page = await viewHostPage(deps, {
      planId: followers,
      deviceToken: device,
      units: "metric",
    });
    if (page.kind !== "found") throw new Error(`not the host page: ${page.kind}`);
    expect(page.visibility.followers).toEqual({ allowed: true });
    // Nothing new can be for followers meanwhile.
    expect(await visibilityChoices(deps, { deviceToken: device })).toMatchObject({
      followers: undefined,
    });
    later(1);
    expect(await edit(device, followers, { title: "Still for followers" })).toMatchObject({
      kind: "updated",
    });
    expect(await stored(followers)).toMatchObject({
      visibility: "followers",
      federatedAt: fixtureNow,
    });
    // Back on: shared again by the same actor, without saving anew.
    withFederation(true);
    expect(await planActor(deps, await stored(followers))).toBe(
      (await profiles.findByHandle("anna"))?.id,
    );
  });
});

describe("the profile page (decision D36)", () => {
  it("lists only the owner's upcoming public plans", async () => {
    const device = await logIn();
    await createProfile(deps, { deviceToken: device, handle: "anna" });
    const shown = await plan(device, { visibility: "public", title: "Shown" });
    await plan(device, { visibility: "followers", title: "Followers only" });
    await plan(device, { title: "Link only" });
    expect(await viewProfilePage(deps, "anna")).toEqual({
      kind: "found",
      handle: "anna",
      displayName: "Anna Müller",
      plans: [expect.objectContaining({ planId: shown, title: "Shown" })],
    });
    expect(await viewProfilePage(deps, "nobody")).toEqual({ kind: "not_found" });
  });
});

describe("turning the profile off (decision D37)", () => {
  it("retires the handle for good and makes followers plans link-only", async () => {
    const device = await logIn();
    await createProfile(deps, { deviceToken: device, handle: "anna" });
    const followers = await plan(device, { visibility: "followers" });
    const publicOne = await plan(device, { visibility: "public" });
    expect((await stored(publicOne)).federatedAt).toEqual(fixtureNow);
    const actor = (await profiles.findByHandle("anna"))?.id ?? "";
    expect(await retireProfile(deps, { deviceToken: device })).toEqual({
      kind: "retired",
      plansNowLinkOnly: 1,
    });
    expect(await stored(followers)).toMatchObject({ visibility: "link", federatedAt: undefined });
    // Public stays public, listed in Nearby, no longer shared by an actor.
    expect(await stored(publicOne)).toMatchObject({ visibility: "public", federatedAt: undefined });
    expect(await planActor(deps, await stored(publicOne))).toBeUndefined();
    expect(await posterActor(deps, actor)).toMatchObject({ kind: "retired" });
    expect(await viewProfilePage(deps, "anna")).toEqual({ kind: "not_found" });
    // A new profile needs a new handle; the old one is nobody's again.
    expect(await createProfile(deps, { deviceToken: device, handle: "anna" })).toEqual({
      kind: "invalid",
      code: "handle_taken",
    });
    expect(await createProfile(deps, { deviceToken: device, handle: "anna_new" })).toMatchObject({
      kind: "created",
    });
    // The new profile shares only what is saved under its own handle (D35).
    expect(await planActor(deps, await stored(publicOne))).toBeUndefined();
  });

  it("finishes on a retry after failing halfway", async () => {
    const device = await logIn();
    await createProfile(deps, { deviceToken: device, handle: "anna" });
    const first = await plan(device, { visibility: "followers" });
    const second = await plan(device, { visibility: "followers" });
    const plans = deps.plans;
    let updates = 0;
    deps = {
      ...deps,
      plans: {
        ...plans,
        update: async (changed) => {
          if (++updates === 2) throw new Error("disk full");
          await plans.update(changed);
        },
      },
    };
    await expect(retireProfile(deps, { deviceToken: device })).rejects.toThrow("disk full");
    // Not retired yet, so turning it off again is still offered.
    expect(await profileSetting(deps, { deviceToken: device })).toEqual({
      kind: "on",
      handle: "anna",
      followers: 0,
    });
    expect(await retireProfile(deps, { deviceToken: device })).toEqual({
      kind: "retired",
      plansNowLinkOnly: 1,
    });
    expect((await stored(first)).visibility).toBe("link");
    expect((await stored(second)).visibility).toBe("link");
    expect(await profileSetting(deps, { deviceToken: device })).toMatchObject({ kind: "off" });
  });

  it("happens when the account is deleted", async () => {
    const device = await logIn();
    await createProfile(deps, { deviceToken: device, handle: "anna" });
    const actor = (await profiles.findByHandle("anna"))?.id ?? "";
    expect(await deleteAccount(deps, { deviceToken: device })).toEqual({ kind: "deleted" });
    expect(await posterActor(deps, actor)).toMatchObject({ kind: "retired" });
  });

  it("happens when the account expires unused", async () => {
    const device = await logIn();
    await createProfile(deps, { deviceToken: device, handle: "anna" });
    const actor = (await profiles.findByHandle("anna"))?.id ?? "";
    later(366 * 24 * 60);
    expect(await expireAccounts(deps)).toBe(1);
    expect(await posterActor(deps, actor)).toMatchObject({ kind: "retired" });
  });
});

const remote = (name: string, server = "social.example") => ({
  id: `https://${server}/users/${name}`,
  inbox: `https://${server}/users/${name}/inbox`,
  sharedInbox: `https://${server}/inbox`,
});

describe("following (decision D38)", () => {
  async function annaActor() {
    const device = await logIn();
    await createProfile(deps, { deviceToken: device, handle: "anna" });
    return { device, actor: (await profiles.findByHandle("anna"))?.id ?? "" };
  }
  const follow = (localActor: string, follower = remote("ben")) =>
    followActor(deps, { localActor, followId: `${follower.id}#follow-1`, follower });

  it("accepts a follow of an active actor at once, showing how many follow", async () => {
    const { device, actor } = await annaActor();
    expect(await follow(actor)).toBe("accepted");
    expect(publisher.sent).toEqual([
      {
        kind: "accept",
        localActor: actor,
        followId: "https://social.example/users/ben#follow-1",
        to: "https://social.example/users/ben",
      },
    ]);
    // Following again changes nothing but the stored inboxes.
    await follow(actor);
    await follow(actor, remote("cleo", "other.example"));
    expect(await profileSetting(deps, { deviceToken: device })).toEqual({
      kind: "on",
      handle: "anna",
      followers: 2,
    });
  });

  it("accepts follows of the instance actor, and of nobody else", async () => {
    expect(await follow(INSTANCE_ACTOR)).toBe("accepted");
    expect(await follow("no-such-actor")).toBe("unknown_actor");
    const { actor } = await annaActor();
    withFederation(false);
    expect(await follow(actor)).toBe("unknown_actor");
    expect(await follow(INSTANCE_ACTOR)).toBe("unknown_actor");
    expect(publisher.sent.map((sent) => sent.localActor)).toEqual([INSTANCE_ACTOR]);
  });

  it("forgets a follower who unfollows, or whose account is deleted on its server", async () => {
    const { actor } = await annaActor();
    await follow(actor);
    await follow(actor, remote("cleo"));
    await follow(INSTANCE_ACTOR, remote("cleo"));
    await unfollowActor(deps, { localActor: actor, remoteActorId: remote("ben").id });
    expect(await followers.list(actor)).toEqual([remote("cleo")]);
    expect(await forgetRemoteActor(deps, remote("cleo").id)).toBe(2);
    expect(await followers.count(actor)).toBe(0);
    expect(await followers.count(INSTANCE_ACTOR)).toBe(0);
  });

  it("tells the followers when the profile is retired, then forgets them", async () => {
    const { device, actor } = await annaActor();
    await follow(actor);
    await follow(actor, remote("cleo", "other.example"));
    await retireProfile(deps, { deviceToken: device });
    expect(publisher.sent.at(-1)).toEqual({
      kind: "deleteActor",
      localActor: actor,
      to: [remote("ben").id, remote("cleo", "other.example").id],
    });
    expect(await followers.count(actor)).toBe(0);
    // A profile nobody follows has nobody to tell.
    await createProfile(deps, { deviceToken: device, handle: "anna_new" });
    const sent = publisher.sent.length;
    await retireProfile(deps, { deviceToken: device });
    expect(publisher.sent).toHaveLength(sent);
  });

  it("tells the followers when the account is deleted, or expires unused", async () => {
    const { device, actor } = await annaActor();
    await follow(actor);
    expect(await deleteAccount(deps, { deviceToken: device })).toEqual({ kind: "deleted" });
    expect(publisher.sent.at(-1)).toEqual({
      kind: "deleteActor",
      localActor: actor,
      to: [remote("ben").id],
    });

    const idle = await logIn("Cleo", "cleo");
    await createProfile(deps, { deviceToken: idle, handle: "cleo" });
    const cleo = (await profiles.findByHandle("cleo"))?.id ?? "";
    await follow(cleo);
    later(366 * 24 * 60);
    expect(await expireAccounts(deps)).toBe(1);
    expect(publisher.sent.at(-1)).toMatchObject({ kind: "deleteActor", localActor: cleo });
    expect(await followers.count(cleo)).toBe(0);
  });

  it("refuses a follower whose inboxes are on another server", async () => {
    expect(
      await follow(INSTANCE_ACTOR, { ...remote("ben"), inbox: "https://victim.example/inbox" }),
    ).toBe("elsewhere");
    expect(
      await follow(INSTANCE_ACTOR, {
        ...remote("ben"),
        sharedInbox: "https://victim.example/inbox",
      }),
    ).toBe("elsewhere");
    expect(await followers.count(INSTANCE_ACTOR)).toBe(0);
    expect(publisher.sent).toEqual([]);
  });

  it("forgets every follower while federation is off, as nothing can reach them", async () => {
    const { actor } = await annaActor();
    await follow(actor);
    await follow(INSTANCE_ACTOR, remote("cleo"));
    expect(await forgetFollowersWhileOff(deps)).toBe(0);
    withFederation(false);
    expect(await forgetFollowersWhileOff(deps)).toBe(2);
    expect(await followers.count(actor)).toBe(0);
  });
});

describe("publishing plans (decisions D38, D39)", () => {
  /** Anna with a profile and one follower, ready to share. */
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

  it("sends followers and public plans to the followers, and never link-only ones", async () => {
    const { device, actor } = await sharing();
    const followersPlan = await plan(device, { visibility: "followers" });
    await plan(device, { visibility: "public" });
    await plan(device, { visibility: "link" });
    expect(publisher.planActivities).toEqual(["create followers", "create public"]);
    expect(publisher.sent.find((sent) => sent.kind === "create")).toMatchObject({
      planId: followersPlan,
      localActor: actor,
      to: [remote("ben").id],
      language: "en",
      // Only what every viewer sees: never the exact start.
      event: {
        id: followersPlan,
        title: sampleInput.title,
        note: sampleInput.note,
        area: { label: sampleInput.areaLabel },
      },
    });
    expect(JSON.stringify(publisher.sent)).not.toContain(sampleInput.exactDescription);
    expect(JSON.stringify(publisher.sent)).not.toContain(sampleInput.exactLat);
  });

  it("shares nothing without a profile, while federation is off, or before the wording was seen", async () => {
    const device = await logIn();
    const before = await plan(device, { visibility: "public" });
    await createProfile(deps, { deviceToken: device, handle: "anna" });
    withFederation(false);
    await plan(device, { visibility: "public" });
    withFederation(true);
    expect(publisher.planActivities).toEqual([]);
    // Saved again under the fediverse wording: now it is sent (D35).
    later(1);
    await edit(device, before, { title: "Saved again" });
    expect(publisher.planActivities).toEqual(["create public"]);
  });

  it("sends an Update when what the Event shows changes, or the plan is cancelled", async () => {
    const { device } = await sharing();
    const planId = await plan(device, { visibility: "public" });
    later(1);
    // The exact start is not in the Event: nothing to tell.
    await edit(device, planId, { exactDescription: "South gate" });
    expect(publisher.planActivities).toEqual(["create public"]);
    await edit(device, planId, { title: "Hill repeats" });
    expect(await cancelPlan(deps, { planId, deviceToken: device })).toEqual({ kind: "cancelled" });
    expect(publisher.planActivities).toEqual(["create public", "update public", "update public"]);
    expect(publisher.sent.at(-1)).toMatchObject({
      event: { title: "Hill repeats", status: "cancelled" },
    });
  });

  it("widens with an Update, and narrows with a Delete, after which it is never sent again", async () => {
    const { device } = await sharing();
    const planId = await plan(device, { visibility: "followers" });
    later(1);
    await edit(device, planId, { visibility: "public" });
    expect(publisher.planActivities).toEqual(["create followers", "update public"]);
    expect(
      (await visibilityChoices(deps, { plan: { id: planId, visibility: "public" } })).fediverse,
    ).toBe("shared");
    await edit(device, planId, { visibility: "followers" });
    expect(publisher.planActivities.at(-1)).toBe("withdraw public");
    await edit(device, planId, { visibility: "public", title: "Back again" });
    expect(publisher.planActivities).toHaveLength(3);
    const choices = await visibilityChoices(deps, { plan: { id: planId, visibility: "public" } });
    expect(choices).toMatchObject({ fediverse: "withdrawn", sharedBy: undefined });

    const linkOnly = await plan(device, { visibility: "followers" });
    await edit(device, linkOnly, { visibility: "link" });
    expect(publisher.planActivities.at(-1)).toBe("withdraw followers");
  });

  it("sends a Delete when the plan is deleted by its host, the instance admin or retention", async () => {
    const { device } = await sharing();
    const deleted = await plan(device, { visibility: "public" });
    const expiring = await plan(device, { visibility: "followers" });
    expect(await deletePlan(deps, { planId: deleted, deviceToken: device })).toEqual({
      kind: "deleted",
    });
    const reported = await plan(device, { visibility: "public" });
    const adminAuth = new FakeAdminAuth();
    const session = adminAuth.startSession(clock.now()).value;
    expect(await deletePlanAsAdmin({ ...deps, adminAuth }, { planId: reported, session })).toEqual({
      kind: "deleted",
    });
    clock.set((await stored(expiring)).deleteAt.toISOString());
    await runRetentionSweep(deps);
    expect(publisher.planActivities).toEqual([
      "create public",
      "create followers",
      "withdraw public",
      "create public",
      "withdraw public",
      "withdraw followers",
    ]);
  });

  it("sends a Delete when the plan is deleted right away by a retention edit, or by a lower maximum", async () => {
    const { device } = await sharing();
    const deletedNow = await plan(device, { visibility: "public" });
    const capped = await plan(device, { visibility: "followers", retentionDays: "30" });
    // Two days after the start, a one-day retention means now.
    clock.set(new Date(sampleStart.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString());
    expect(
      await editPlan(deps, {
        planId: deletedNow,
        deviceToken: device,
        input: { ...planToInput(await stored(deletedNow), "metric"), retentionDays: "1" },
        units: "metric",
        confirmDeleteNow: true,
      }),
    ).toEqual({ kind: "deleted" });
    await applyRetentionMax(deps, { maxRetentionDays: 1 });
    expect(await deps.plans.findById(capped)).toBeUndefined();
    expect(publisher.planActivities).toEqual([
      "create public",
      "create followers",
      "withdraw public",
      "withdraw followers",
    ]);
  });

  it("sends an Update when a route moves the public point, and nothing for a cancelled plan never sent", async () => {
    const { device } = await sharing();
    const planId = await plan(device, { visibility: "public", exactLat: "", exactLng: "" });
    const before = publisher.sent.at(-1);
    expect(
      await setRoute(deps, {
        planId,
        deviceToken: device,
        gpx: fakeGpx({
          segments: [
            [
              { lat: 47.1, lng: 10.9, ele: 800 },
              { lat: 47.11, lng: 10.9, ele: 850 },
            ],
          ],
        }),
      }),
    ).toEqual({ kind: "saved" });
    const update = publisher.sent.at(-1);
    expect(update).toMatchObject({ kind: "update", audience: "public" });
    expect(update).not.toEqual(before);

    // Shared under the profile while nothing could be sent: a cancelled plan is not announced.
    const actors = deps.posterActors!;
    deps = { ...deps, posterActors: { ...actors, publisher: undefined } };
    const unsent = await plan(device, { visibility: "public" });
    deps = { ...deps, posterActors: actors };
    const sent = publisher.sent.length;
    expect(await cancelPlan(deps, { planId: unsent, deviceToken: device })).toEqual({
      kind: "cancelled",
    });
    expect(publisher.sent).toHaveLength(sent);
  });

  it("leaves a retired profile's plans to the actor's Delete, and never sends them again", async () => {
    const { device } = await sharing();
    const planId = await plan(device, { visibility: "public" });
    await retireProfile(deps, { deviceToken: device });
    expect(publisher.sent.map((sent) => sent.kind)).toEqual(["accept", "create", "deleteActor"]);
    await createProfile(deps, { deviceToken: device, handle: "anna_new" });
    const newActor = (await profiles.findByHandle("anna_new"))?.id ?? "";
    await followActor(deps, {
      localActor: newActor,
      followId: `${remote("ben").id}#follow-2`,
      follower: remote("ben"),
    });
    later(1);
    await edit(device, planId, { title: "Under the new profile" });
    expect(publisher.planActivities).toEqual(["create public"]);
    // Account deletion, too, relies on the actor's Delete.
    const other = await plan(device, { visibility: "public" });
    expect(publisher.planActivities).toEqual(["create public", "create public"]);
    await deleteAccount(deps, { deviceToken: device });
    expect(publisher.sent.at(-1)).toMatchObject({ kind: "deleteActor", localActor: newActor });
    expect(publisher.sent.some((sent) => sent.kind === "withdraw" && sent.planId === other)).toBe(
      false,
    );
  });
});
