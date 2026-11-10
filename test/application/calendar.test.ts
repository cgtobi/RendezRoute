// Calendar download and personal feed (spec 6 feature 2, decisions D18 and I40).
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  createCalendarFeed,
  planCalendar,
  readCalendarFeed,
  stopCalendarFeed,
  viewCalendarFeed,
} from "../../src/application/calendar.ts";
import {
  acceptRequest,
  cancelPlan,
  deletePlan,
  editPlan,
  rejectRequest,
  removePerson,
} from "../../src/application/host.ts";
import { createPlan, type PlanDeps } from "../../src/application/plans.ts";
import { respond } from "../../src/application/responses.ts";
import { planToInput } from "../../src/domain/plan-edit.ts";
import { FakeClock } from "../fakes/clock.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

const DAY = 24 * 60 * 60 * 1000;

let deps: PlanDeps;
let repos: ReturnType<typeof createFakeRepositories>;
let clock: FakeClock;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;

beforeEach(() => {
  repos = createFakeRepositories();
  clock = new FakeClock(fixtureNow);
  deps = {
    ...repos,
    routeParser: new FakeRouteParser(),
    tokens: new FakeTokenService(),
    ids: new SequentialIdGenerator(),
    clock,
    limits: { horizonDays: 180, maxRetentionDays: 30 },
    postingMode: "anyone",
  };
});

async function newPlan(title: string, deviceToken?: string) {
  const created = await createPlan(deps, {
    input: { ...sampleInput, title, joinMode: "approval" },
    units: "metric",
    language: "en",
    creationNonce: nonce(),
    deviceToken,
  });
  if (created.kind !== "created") throw new Error("setup failed");
  return { planId: created.planId, host: created.newDeviceToken ?? deviceToken };
}

async function respondTo(planId: string, choice: string, deviceToken?: string) {
  const result = await respond(deps, {
    planId,
    choice,
    displayName: "Ben",
    requestNote: "",
    language: "en",
    creationNonce: nonce(),
    deviceToken,
  });
  if (result.kind !== "created") throw new Error(`respond failed: ${result.kind}`);
  const response = await repos.responses.findByManageTokenHash(
    deps.tokens.hash(result.manageToken),
  );
  return { responseId: response?.id ?? "", device: result.newDeviceToken ?? deviceToken };
}

async function newFeed(deviceToken: string | undefined, language = "en"): Promise<string> {
  const created = await createCalendarFeed(deps, { deviceToken, language });
  if (created.kind !== "created") throw new Error(created.kind);
  return created.token;
}

async function feedOf(token: string) {
  const feed = await readCalendarFeed(deps, { token });
  return feed.kind === "found"
    ? feed.entries.map((entry) => `${entry.title}${entry.hosting ? " (host)" : ""} ${entry.status}`)
    : feed.kind;
}

describe("the one-off download (spec 6 feature 2)", () => {
  it("has the exact start only for participants and the host", async () => {
    const { planId, host } = await newPlan("Run");
    const interested = await respondTo(planId, "interested");
    const pending = await respondTo(planId, "requested");
    const joined = await respondTo(planId, "requested");
    await acceptRequest(deps, { planId, deviceToken: host, responseId: joined.responseId });

    const exactStart = async (deviceToken: string | undefined) => {
      const result = await planCalendar(deps, { planId, deviceToken });
      if (result.kind !== "found") throw new Error("missing");
      return result.entry.exactStart?.description;
    };
    expect(await exactStart(undefined)).toBeUndefined();
    expect(await exactStart(interested.device)).toBeUndefined();
    expect(await exactStart(pending.device)).toBeUndefined();
    expect(await exactStart(joined.device)).toBe(sampleInput.exactDescription);
    expect(await exactStart(host)).toBe(sampleInput.exactDescription);
  });

  it("carries the public details, an estimated end and the deletion date", async () => {
    const { planId } = await newPlan("Run");
    const result = await planCalendar(deps, { planId, deviceToken: undefined });
    if (result.kind !== "found") throw new Error("missing");
    const plan = await repos.plans.findById(planId);
    expect(result.entry).toEqual({
      planId,
      title: "Run",
      startsAt: plan?.startsAt,
      // 12.5 km at 6:00 per km.
      endsAt: new Date((plan?.startsAt.getTime() ?? 0) + 75 * 60 * 1000),
      timeZone: "Europe/Berlin",
      areaLabel: sampleInput.areaLabel,
      status: "active",
      deleteAt: plan?.deleteAt,
      hosting: false,
      exactStart: undefined,
    });
    expect(await planCalendar(deps, { planId: "missing", deviceToken: undefined })).toEqual({
      kind: "not_found",
    });
  });
});

describe("the personal feed (spec 6 feature 2)", () => {
  it("lists hosted plans and plans responded to, not those where the device was rejected or removed", async () => {
    const { planId: hosted, host: device } = await newPlan("Hosted");
    const { planId: other, host: otherHost } = await newPlan("Interested");
    await respondTo(other, "interested", device);
    const { planId: pendingPlan } = await newPlan("Pending");
    await respondTo(pendingPlan, "requested", device);
    const { planId: rejectedPlan, host: rejectedHost } = await newPlan("Rejected");
    const rejected = await respondTo(rejectedPlan, "requested", device);
    await rejectRequest(deps, {
      planId: rejectedPlan,
      deviceToken: rejectedHost,
      responseId: rejected.responseId,
    });
    const { planId: removedPlan, host: removedHost } = await newPlan("Removed");
    const removed = await respondTo(removedPlan, "requested", device);
    await acceptRequest(deps, {
      planId: removedPlan,
      deviceToken: removedHost,
      responseId: removed.responseId,
    });
    await removePerson(deps, {
      planId: removedPlan,
      deviceToken: removedHost,
      responseId: removed.responseId,
    });
    expect(hosted && otherHost).toBeTruthy();

    const token = await newFeed(device, "de");
    expect(await feedOf(token)).toEqual([
      "Hosted (host) active",
      "Interested active",
      "Pending active",
    ]);
    const feed = await readCalendarFeed(deps, { token });
    expect(feed.kind === "found" && feed.language).toBe("de");
    expect(feed.kind === "found" && feed.entries.every((e) => e.exactStart === undefined)).toBe(
      true,
    );
  });

  it("reflects changes, cancellations and deletions on the next poll", async () => {
    const { planId: kept, host } = await newPlan("Run");
    const { planId: dropped } = await newPlan("Ride", host);
    const token = await newFeed(host);
    expect(await feedOf(token)).toEqual(["Run (host) active", "Ride (host) active"]);

    const plan = await repos.plans.findById(kept);
    if (plan === undefined) throw new Error("missing");
    await editPlan(deps, {
      planId: kept,
      deviceToken: host,
      input: { ...planToInput(plan, "metric"), title: "Long run" },
      units: "metric",
      confirmDeleteNow: false,
    });
    await cancelPlan(deps, { planId: kept, deviceToken: host });
    await deletePlan(deps, { planId: dropped, deviceToken: host });
    expect(await feedOf(token)).toEqual(["Long run (host) cancelled"]);
  });

  it("is sorted by start", async () => {
    const { host } = await newPlan("Later");
    const plan = await newPlan("Earlier", host);
    const earlier = await repos.plans.findById(plan.planId);
    if (earlier === undefined) throw new Error("missing");
    await repos.plans.update({ ...earlier, startsAt: new Date(earlier.startsAt.getTime() - DAY) });
    const token = await newFeed(host);
    expect(await feedOf(token)).toEqual(["Earlier (host) active", "Later (host) active"]);
  });

  it("does not count as device activity (decision D18)", async () => {
    const { host } = await newPlan("Run");
    const token = await newFeed(host);
    const seen = repos.devices.all()[0]?.lastSeenAt;
    clock.set(new Date(fixtureNow.getTime() + 3 * DAY).toISOString());
    await readCalendarFeed(deps, { token });
    expect(repos.devices.all()[0]?.lastSeenAt).toEqual(seen);
  });

  it("has one link per device: a new one replaces the old, stopping ends it", async () => {
    const { host } = await newPlan("Run");
    const first = await newFeed(host);
    const second = await newFeed(host);
    expect(await feedOf(first)).toBe("not_found");
    expect(await feedOf(second)).toEqual(["Run (host) active"]);
    await stopCalendarFeed(deps, { deviceToken: host });
    expect(await feedOf(second)).toBe("not_found");
  });

  it("is only for browsers with plans to list, and stores only the token's hash (spec 3.10)", async () => {
    const nothing = { kind: "nothing_linked" };
    expect(await createCalendarFeed(deps, { deviceToken: undefined, language: "en" })).toEqual(
      nothing,
    );
    expect(repos.devices.all()).toEqual([]);
    const { planId, host } = await newPlan("Run");
    const rejected = await respondTo(planId, "requested");
    await rejectRequest(deps, { planId, deviceToken: host, responseId: rejected.responseId });
    expect(
      await createCalendarFeed(deps, { deviceToken: rejected.device, language: "en" }),
    ).toEqual(nothing);

    const token = await newFeed(host);
    const feed = await repos.calendarFeeds.findForDevice(repos.devices.all()[0]?.id ?? "");
    expect(JSON.stringify(feed)).not.toContain(token);
  });
});

describe("the feed page", () => {
  it("says whether this browser has a feed and whether it can have one", async () => {
    expect(await viewCalendarFeed(deps, { deviceToken: undefined })).toEqual({
      hasFeed: false,
      canCreate: false,
    });
    const { host } = await newPlan("Run");
    expect(await viewCalendarFeed(deps, { deviceToken: host })).toEqual({
      hasFeed: false,
      canCreate: true,
    });
    await newFeed(host);
    expect(await viewCalendarFeed(deps, { deviceToken: host })).toEqual({
      hasFeed: true,
      canCreate: true,
    });
  });
});
