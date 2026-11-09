// Plan ratings (spec 6a, decision D20), step 1: participants rate while the recap is open.
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { acceptRequest, editPlan, removePerson } from "../../src/application/host.ts";
import { confirmHostLink } from "../../src/application/secret-links.ts";
import { planToInput } from "../../src/domain/plan-edit.ts";
import { createPlan, type PlanDeps, viewPlan } from "../../src/application/plans.ts";
import { ratePlan, removeRating } from "../../src/application/ratings.ts";
import { respond } from "../../src/application/responses.ts";
import { FakeClock } from "../fakes/clock.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

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
