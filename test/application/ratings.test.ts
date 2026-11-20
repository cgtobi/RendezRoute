// Plan ratings (spec 6a, decision D20), step 1: participants rate while the recap is open.
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { acceptRequest, editPlan, removePerson, viewHostPage } from "../../src/application/host.ts";
import { confirmHostLink } from "../../src/application/secret-links.ts";
import { planToInput } from "../../src/domain/plan-edit.ts";
import { countedRatings } from "../../src/application/plan-views.ts";
import { createPlan, type PlanDeps, viewPlan } from "../../src/application/plans.ts";
import { freezeRatingTally, ratePlan, removeRating } from "../../src/application/ratings.ts";
import { respond, withdrawMyResponse } from "../../src/application/responses.ts";
import { FakeClock } from "../fakes/clock.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";
import { addRemoteJoined } from "../support/plans.ts";

// sampleInput starts on 7 June 2026 at 07:30 in Berlin (05:30 UTC); recap open for 1 week.
const STARTED = "2026-06-07T06:00:00Z";
const CLOSED = "2026-06-14T05:30:00Z";

let deps: PlanDeps;
let repos: ReturnType<typeof createFakeRepositories>;
let clock: FakeClock;
let planId: string;
let host: string | undefined;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;

beforeEach(async () => {
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
  const created = await createPlan(deps, {
    input: { ...sampleInput, joinMode: "approval" },
    units: "metric",
    language: "en",
    creationNonce: nonce(),
    deviceToken: undefined,
  });
  if (created.kind !== "created") throw new Error("setup failed");
  planId = created.planId;
  host = created.newDeviceToken;
  hostToken = created.hostToken;
});

let hostToken: string;

async function person(name: string, choice: "interested" | "joined") {
  const result = await respond(deps, {
    planId,
    choice: choice === "joined" ? "requested" : "interested",
    displayName: name,
    requestNote: "",
    language: "en",
    creationNonce: nonce(),
    deviceToken: undefined,
  });
  if (result.kind !== "created") throw new Error(`respond failed: ${result.kind}`);
  if (choice === "joined") {
    const response = await repos.responses.findByManageTokenHash(
      deps.tokens.hash(result.manageToken),
    );
    await acceptRequest(deps, { planId, deviceToken: host, responseId: response?.id ?? "" });
  }
  return result.newDeviceToken;
}

const rate = (deviceToken: string | undefined, value = "up", note = "") =>
  ratePlan(deps, { planId, deviceToken, value, note });

const ownRating = async (deviceToken: string | undefined) => {
  const view = await viewPlan(deps, { planId, deviceToken });
  return view.kind === "participant" ? view.view.rating : "not a participant";
};

describe("ratePlan (spec 6a)", () => {
  it("lets a participant rate while the recap is open, and change the rating", async () => {
    const ben = await person("Ben", "joined");
    clock.set(STARTED);
    expect(await ownRating(ben)).toEqual({ canRate: true, own: undefined });
    expect(await rate(ben, "down", "Too fast for me.")).toEqual({ kind: "saved" });
    expect(await ownRating(ben)).toEqual({
      canRate: true,
      own: { value: "down", note: "Too fast for me." },
    });
    expect(await rate(ben, "up")).toEqual({ kind: "saved" });
    expect(await ownRating(ben)).toEqual({ canRate: true, own: { value: "up", note: undefined } });
  });

  it("is closed before the start and after the recap closes; the own rating stays visible", async () => {
    const ben = await person("Ben", "joined");
    expect(await rate(ben)).toEqual({ kind: "closed" });
    expect(await ownRating(ben)).toBeUndefined();
    clock.set(STARTED);
    await rate(ben, "down");
    clock.set(CLOSED);
    expect(await rate(ben, "up")).toEqual({ kind: "closed" });
    expect(await removeRating(deps, { planId, deviceToken: ben })).toEqual({ kind: "closed" });
    expect(await ownRating(ben)).toEqual({
      canRate: false,
      own: { value: "down", note: undefined },
    });
  });

  it("refuses interested people, the host and devices without a response", async () => {
    const ida = await person("Ida", "interested");
    clock.set(STARTED);
    expect(await rate(ida)).toEqual({ kind: "forbidden" });
    expect(await rate(host)).toEqual({ kind: "forbidden" });
    expect(await rate(undefined)).toEqual({ kind: "forbidden" });
    expect(
      await ratePlan(deps, { planId: "nope", deviceToken: ida, value: "up", note: "" }),
    ).toEqual({ kind: "not_found" });
  });

  it("reports invalid input", async () => {
    const ben = await person("Ben", "joined");
    clock.set(STARTED);
    expect(await rate(ben, "meh", "x".repeat(501))).toEqual({
      kind: "invalid",
      errors: [
        { field: "value", code: "choice_invalid" },
        { field: "note", code: "too_long" },
      ],
    });
  });

  it("can be removed while the recap is open", async () => {
    const ben = await person("Ben", "joined");
    clock.set(STARTED);
    await rate(ben, "up", "Lovely.");
    expect(await removeRating(deps, { planId, deviceToken: ben })).toEqual({ kind: "removed" });
    expect(await ownRating(ben)).toEqual({ canRate: true, own: undefined });
  });

  it("never shows anyone else's rating, nor ratings to the host in step 1", async () => {
    const ben = await person("Ben", "joined");
    const lea = await person("Lea", "joined");
    clock.set(STARTED);
    await rate(ben, "down", "SENTINEL-ben-note");
    expect(JSON.stringify(await viewPlan(deps, { planId, deviceToken: lea }))).not.toContain(
      "SENTINEL",
    );
    expect(JSON.stringify(await viewPlan(deps, { planId, deviceToken: host }))).not.toContain(
      "SENTINEL",
    );
  });
});

describe("ratings and the host's actions (spec 3.5, 6.6, 6a)", () => {
  it("are deleted when the host removes the participant", async () => {
    const ben = await person("Ben", "joined");
    clock.set(STARTED);
    await rate(ben, "down", "SENTINEL-note");
    const response = (await repos.responses.listByPlan(planId)).find(
      (r) => r.displayName === "Ben",
    );
    await removePerson(deps, { planId, deviceToken: host, responseId: response?.id ?? "" });
    expect(await repos.ratings.findByResponse(response?.id ?? "")).toBeUndefined();
  });

  it("are refused to a participant's device that also holds the host link", async () => {
    const ben = await person("Ben", "joined");
    await confirmHostLink(deps, { token: hostToken, deviceToken: ben });
    clock.set(STARTED);
    expect(await rate(ben)).toEqual({ kind: "forbidden" });
  });

  it("stay closed when the host reopens a closed recap (decision D20)", async () => {
    const ben = await person("Ben", "joined");
    clock.set(STARTED);
    await rate(ben, "up");
    // The week has passed; the host picks "1 day", which reopens the recap for comments.
    clock.set("2026-06-15T10:00:00Z");
    const plan = await repos.plans.findById(planId);
    if (plan === undefined) throw new Error("missing plan");
    const edited = await editPlan(deps, {
      planId,
      deviceToken: host,
      input: { ...planToInput(plan, "metric"), recapWindow: "1d" },
      units: "metric",
      confirmDeleteNow: false,
    });
    expect(edited.kind).toBe("updated");
    expect(await repos.plans.findById(planId)).toMatchObject({
      ratingsClosedAt: new Date(CLOSED),
    });
    expect(await rate(ben, "down")).toEqual({ kind: "closed" });
    expect(await ownRating(ben)).toEqual({ canRate: false, own: { value: "up", note: undefined } });
  });
});

describe("the host's result (spec 6a: after the close, from 3 participants)", () => {
  const hostResult = async () => {
    const page = await viewHostPage(deps, { planId, deviceToken: host, units: "metric" });
    const plan = await viewPlan(deps, { planId, deviceToken: host, withRatingResult: true });
    if (page.kind !== "found" || plan.kind !== "poster") throw new Error("not the host");
    expect(plan.view.ratingResult).toEqual(page.rating?.result);
    return page.rating?.result;
  };

  it("shows counts against participants and the signed notes once the recap has closed", async () => {
    const [ben, lea] = [await person("Ben", "joined"), await person("Lea", "joined")];
    await person("Max", "joined");
    await person("Ida", "interested");
    clock.set(STARTED);
    await rate(ben, "down", "Too fast for me.");
    await rate(lea, "up");
    expect(await hostResult()).toBeUndefined();
    clock.set(CLOSED);
    expect(await hostResult()).toEqual({
      participants: 3,
      rated: 2,
      up: 1,
      down: 1,
      notes: [{ authorName: "Ben", value: "down", note: "Too fast for me." }],
    });
  });

  it("stays hidden for plans with fewer than 3 participants", async () => {
    const ben = await person("Ben", "joined");
    await person("Lea", "joined");
    clock.set(STARTED);
    await rate(ben, "up");
    clock.set(CLOSED);
    expect(await hostResult()).toBeUndefined();
  });

  it("is never in anyone else's view", async () => {
    const [ben, lea] = [await person("Ben", "joined"), await person("Lea", "joined")];
    await person("Max", "joined");
    const ida = await person("Ida", "interested");
    clock.set(STARTED);
    await rate(ben, "down", "SENTINEL-ben-note");
    clock.set(CLOSED);
    for (const device of [lea, ida, undefined]) {
      const body = JSON.stringify(await viewPlan(deps, { planId, deviceToken: device }));
      expect(body).not.toContain("SENTINEL");
      expect(body).not.toContain("ratingResult");
    }
  });
});

describe("the host's counts stay fixed after the close (decision D20)", () => {
  async function closedWithFour() {
    const devices = [];
    for (const name of ["Ben", "Lea", "Max", "Tom"]) devices.push(await person(name, "joined"));
    const [ben, lea, max] = devices;
    clock.set(STARTED);
    await rate(ben, "down");
    await rate(lea, "up");
    await rate(max, "up");
    clock.set(CLOSED);
    return { ben, lea };
  }
  const hostResult = async () => {
    const page = await viewHostPage(deps, { planId, deviceToken: host, units: "metric" });
    return page.kind === "found" ? page.rating?.result : undefined;
  };
  const responseOf = async (name: string) =>
    (await repos.responses.listByPlan(planId)).find((r) => r.displayName === name)?.id ?? "";

  it("when the host removes someone who rated", async () => {
    await closedWithFour();
    expect(await hostResult()).toMatchObject({ participants: 4, rated: 3, up: 2, down: 1 });
    await removePerson(deps, { planId, deviceToken: host, responseId: await responseOf("Ben") });
    expect(await hostResult()).toMatchObject({ participants: 4, rated: 3, up: 2, down: 1 });
  });

  it("when a participant withdraws, and below 3 remaining participants", async () => {
    const { ben, lea } = await closedWithFour();
    await withdrawMyResponse(deps, { planId, deviceToken: ben });
    await withdrawMyResponse(deps, { planId, deviceToken: lea });
    expect(await hostResult()).toMatchObject({ participants: 4, rated: 3, up: 2, down: 1 });
  });

  it("are shown while a closed recap is reopened for comments", async () => {
    await closedWithFour();
    clock.set("2026-06-15T10:00:00Z");
    const plan = await repos.plans.findById(planId);
    if (plan === undefined) throw new Error("missing plan");
    await editPlan(deps, {
      planId,
      deviceToken: host,
      input: { ...planToInput(plan, "metric"), recapWindow: "1d" },
      units: "metric",
      confirmDeleteNow: false,
    });
    expect(await hostResult()).toMatchObject({ participants: 4, rated: 3, up: 2, down: 1 });
  });
});

describe("people who joined from another server cannot rate, so they do not count", () => {
  const hostResult = async () => {
    const page = await viewHostPage(deps, { planId, deviceToken: host, units: "metric" });
    return page.kind === "found" ? page.rating : undefined;
  };

  it("keeps a plan with 1 web and 2 remote participants below the minimum of 3", async () => {
    const ben = await person("Ben", "joined");
    await addRemoteJoined(deps, planId, "remote-a");
    await addRemoteJoined(deps, planId, "remote-b");
    clock.set(STARTED);
    await rate(ben, "up");
    clock.set(CLOSED);
    expect(await hostResult()).toMatchObject({ closed: true, result: undefined, minimum: 3 });
    const poster = await viewPlan(deps, { planId, deviceToken: host, withRatingResult: true });
    expect(poster.kind === "poster" && poster.view.ratingResult).toBeUndefined();
  });

  it("counts only web participants as N, against the configured minimum", async () => {
    deps = { ...deps, ratingMinParticipants: 2 };
    const [ben, lea] = [await person("Ben", "joined"), await person("Lea", "joined")];
    await addRemoteJoined(deps, planId, "remote-a");
    clock.set(STARTED);
    await rate(ben, "up");
    await rate(lea, "down");
    clock.set(CLOSED);
    expect(await hostResult()).toMatchObject({
      minimum: 2,
      result: { participants: 2, rated: 2, up: 1, down: 1 },
    });
  });

  it("stores N without the remote participants when the counts are frozen", async () => {
    deps = { ...deps, ratingMinParticipants: 2 };
    const [ben, lea] = [await person("Ben", "joined"), await person("Lea", "joined")];
    await addRemoteJoined(deps, planId, "remote-a");
    await addRemoteJoined(deps, planId, "remote-b");
    clock.set(STARTED);
    await rate(ben, "up");
    await rate(lea, "down");
    clock.set(CLOSED);
    const plan = await repos.plans.findById(planId);
    if (plan === undefined) throw new Error("missing plan");
    await freezeRatingTally(deps, plan);
    expect((await repos.plans.findById(planId))?.ratingTally).toEqual({
      participants: 2,
      rated: 2,
      up: 1,
      down: 1,
    });
  });

  it("compares a stored tally with the current minimum", async () => {
    deps = { ...deps, ratingMinParticipants: 2 };
    const [ben, lea] = [await person("Ben", "joined"), await person("Lea", "joined")];
    clock.set(STARTED);
    await rate(ben, "up");
    await rate(lea, "up");
    clock.set(CLOSED);
    const plan = await repos.plans.findById(planId);
    if (plan === undefined) throw new Error("missing plan");
    await freezeRatingTally(deps, plan);
    expect((await hostResult())?.result).toMatchObject({ participants: 2 });
    deps = { ...deps, ratingMinParticipants: 3 };
    expect((await hostResult())?.result).toBeUndefined();
  });
});

describe("countedRatings", () => {
  it("counts only ratings of people still in, against the participants", async () => {
    const ben = await person("Ben", "joined");
    await person("Lea", "joined");
    clock.set(STARTED);
    await rate(ben, "down");
    const responses = await repos.responses.listByPlan(planId);
    const rating = await repos.ratings.findByResponse(
      responses.find((r) => r.displayName === "Ben")?.id ?? "",
    );
    if (rating === undefined) throw new Error("no rating");
    const benLeft = responses.map((r) =>
      r.displayName === "Ben" ? { ...r, kind: "interested" as const } : r,
    );
    expect(countedRatings([rating], responses, new Set())).toMatchObject({ counted: [rating] });
    expect(countedRatings([rating], benLeft, new Set())).toMatchObject({
      participants: [{ displayName: "Lea" }],
      counted: [],
    });
    const remote = new Set([responses.find((r) => r.displayName === "Lea")?.id ?? ""]);
    expect(countedRatings([rating], responses, remote)).toMatchObject({
      participants: [{ displayName: "Ben" }],
      counted: [rating],
    });
  });
});
