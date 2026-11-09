import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createPlan, type PlanDeps, viewPlan } from "../../src/application/plans.ts";
import {
  respond,
  updateMyResponse,
  viewMyResponse,
  withdrawMyResponse,
} from "../../src/application/responses.ts";
import { confirmManageLink, openManageLink } from "../../src/application/secret-links.ts";
import { FakeClock } from "../fakes/clock.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

let deps: PlanDeps;
let repos: ReturnType<typeof createFakeRepositories>;
let clock: FakeClock;
let planId: string;
let hostDevice: string | undefined;
let nonceCounter = 0;

const nonce = () => `nonce-${String(++nonceCounter).padStart(16, "0")}`;

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
    input: sampleInput,
    units: "metric",
    language: "en",
    creationNonce: nonce(),
    deviceToken: undefined,
  });
  if (created.kind !== "created") throw new Error("setup failed");
  planId = created.planId;
  hostDevice = created.newDeviceToken;
});

async function respondAs(displayName: string, choice: string, deviceToken?: string) {
  return respond(deps, {
    planId,
    choice,
    displayName,
    language: "de",
    creationNonce: nonce(),
    deviceToken,
  });
}

async function joined(displayName = "Ben", choice = "joined") {
  const result = await respondAs(displayName, choice);
  if (result.kind !== "created") throw new Error(`expected created, got ${result.kind}`);
  return result;
}

describe("respond (spec 5 feature 5)", () => {
  it("records the response, issues a manage link and links a new device", async () => {
    const result = await joined();
    expect(result).toMatchObject({
      kind: "created",
      planId,
      manageToken: expect.any(String),
      newDeviceToken: expect.any(String),
    });
    const stored = await repos.responses.findByManageTokenHash(
      deps.tokens.hash(result.manageToken),
    );
    expect(stored).toMatchObject({ kind: "joined", displayName: "Ben", language: "de" });
  });

  it("validates the display name and keeps the host's name for the host", async () => {
    expect(await respondAs("", "joined")).toEqual({
      kind: "invalid",
      errors: [{ field: "displayName", code: "required" }],
    });
    expect(await respondAs("anna", "joined")).toEqual({
      kind: "invalid",
      errors: [{ field: "displayName", code: "name_taken_by_host" }],
    });
  });

  it("accepts only the open-mode choices", async () => {
    expect(await respondAs("Ben", "requested")).toEqual({ kind: "bad_request" });
  });

  it("closes at the start time (spec 3.1 Responding)", async () => {
    clock.set("2026-06-07T05:30:00Z");
    expect(await respondAs("Ben", "joined")).toEqual({ kind: "closed", reason: "plan_started" });
  });

  it("does not let the host respond to their own plan", async () => {
    expect(await respondAs("Ben", "joined", hostDevice)).toEqual({ kind: "is_host" });
  });

  it("sends a device that already responded to its manage page", async () => {
    const first = await joined();
    expect(await respondAs("Ben again", "interested", first.newDeviceToken)).toEqual({
      kind: "already_responded",
      planId,
    });
  });

  it("refuses a removed person on the same device (spec 3.5)", async () => {
    const first = await joined();
    const response = await repos.responses.findByManageTokenHash(
      deps.tokens.hash(first.manageToken),
    );
    if (response === undefined) throw new Error("missing");
    await repos.responses.update({ ...response, kind: "removed", previousKind: "joined" });
    expect(await respondAs("Ben", "joined", first.newDeviceToken)).toEqual({ kind: "blocked" });
  });

  it("treats a resubmitted or concurrently doubled form as one response", async () => {
    const fixed = nonce();
    const submit = () =>
      respond(deps, {
        planId,
        choice: "joined",
        displayName: "Ben",
        language: "en",
        creationNonce: fixed,
        deviceToken: undefined,
      });
    const results = await Promise.all([submit(), submit()]);
    expect(results.map((r) => r.kind).sort()).toEqual(["created", "duplicate"]);
    expect(await repos.responses.counts(planId)).toEqual({ interested: 0, participants: 1 });
  });

  it("rejects malformed nonces and unknown plans", async () => {
    expect(
      await respond(deps, {
        planId,
        choice: "joined",
        displayName: "Ben",
        language: "en",
        creationNonce: "x",
        deviceToken: undefined,
      }),
    ).toEqual({
      kind: "bad_request",
    });
    expect(
      await respond(deps, {
        planId: "nope",
        choice: "joined",
        displayName: "Ben",
        language: "en",
        creationNonce: nonce(),
        deviceToken: undefined,
      }),
    ).toEqual({
      kind: "not_found",
    });
  });
});

describe("viewPlan per audience (spec 3.6)", () => {
  it("reports whether responses are still open", async () => {
    clock.set("2026-06-07T05:30:00Z");
    const result = await viewPlan(deps, { planId, deviceToken: undefined });
    expect(result).toMatchObject({ kind: "viewer", responsesOpen: false });
  });

  async function setupPeople() {
    const ben = await joined("SENTINEL-Ben", "joined");
    const cleo = await joined("SENTINEL-Cleo", "interested");
    return { ben, cleo };
  }

  it("viewers see counts but no names and no exact start", async () => {
    await setupPeople();
    const result = await viewPlan(deps, { planId, deviceToken: undefined });
    if (result.kind !== "viewer") throw new Error(`expected viewer, got ${result.kind}`);
    expect(result.view.counts).toEqual({ interested: 1, participants: 1 });
    expect(result.responsesOpen).toBe(true);
    expect(JSON.stringify(result)).not.toContain("SENTINEL");
    expect(JSON.stringify(result)).not.toContain("North gate");
  });

  it("interested people see their own status, but no names and no exact start", async () => {
    const { cleo } = await setupPeople();
    const result = await viewPlan(deps, { planId, deviceToken: cleo.newDeviceToken });
    expect(result).toMatchObject({
      kind: "responder",
      view: { ownResponse: { kind: "interested", displayName: "SENTINEL-Cleo" } },
    });
    expect(JSON.stringify(result)).not.toContain("SENTINEL-Ben");
    expect(JSON.stringify(result)).not.toContain("North gate");
  });

  it("participants see the exact start and participant names (host first), but not interested names", async () => {
    const { ben } = await setupPeople();
    const result = await viewPlan(deps, { planId, deviceToken: ben.newDeviceToken });
    expect(result.kind).toBe("participant");
    if (result.kind !== "participant") return;
    expect(result.view.exactStart?.description).toBe("North gate, by the bike racks");
    expect(result.view.participants).toEqual([
      { name: "Anna", isHost: true },
      { name: "SENTINEL-Ben", isHost: false },
    ]);
    expect(JSON.stringify(result)).not.toContain("SENTINEL-Cleo");
  });

  it("the poster sees participants and interested people", async () => {
    await setupPeople();
    const result = await viewPlan(deps, { planId, deviceToken: hostDevice });
    expect(result.kind).toBe("poster");
    if (result.kind !== "poster") return;
    expect(result.view.participants.map((p) => p.name)).toEqual(["Anna", "SENTINEL-Ben"]);
    expect(result.view.interested.map((p) => p.name)).toEqual(["SENTINEL-Cleo"]);
  });

  it("removed people see only what rejected people see, plus their status", async () => {
    const { ben } = await setupPeople();
    const response = await repos.responses.findByManageTokenHash(deps.tokens.hash(ben.manageToken));
    if (response === undefined) throw new Error("missing");
    await repos.responses.update({ ...response, kind: "removed", previousKind: "joined" });
    const result = await viewPlan(deps, { planId, deviceToken: ben.newDeviceToken });
    expect(result).toMatchObject({ kind: "responder", view: { ownResponse: { kind: "removed" } } });
    expect(JSON.stringify(result)).not.toContain("North gate");
    if (result.kind === "not_found") throw new Error("missing");
    expect(result.view.counts).toEqual({ interested: 1, participants: 0 });
  });
});

describe("manage page (spec 5 feature 6)", () => {
  it("shows the device's own response", async () => {
    const ben = await joined();
    expect(await viewMyResponse(deps, { planId, deviceToken: ben.newDeviceToken })).toMatchObject({
      kind: "found",
      response: { kind: "joined", displayName: "Ben" },
      canChange: true,
    });
    expect(await viewMyResponse(deps, { planId, deviceToken: undefined })).toEqual({
      kind: "not_found",
    });
  });

  it("changes the response and the name", async () => {
    const ben = await joined();
    expect(
      await updateMyResponse(deps, {
        planId,
        deviceToken: ben.newDeviceToken,
        choice: "interested",
        displayName: "Benjamin",
      }),
    ).toEqual({
      kind: "updated",
      notifiedHost: false,
    });
    expect(await viewMyResponse(deps, { planId, deviceToken: ben.newDeviceToken })).toMatchObject({
      response: { kind: "interested", displayName: "Benjamin" },
    });
  });

  it("refuses only a switch that would notify the host once the caller's limit is used up", async () => {
    const ben = await joined();
    const update = (choice: string, displayName: string) =>
      updateMyResponse(deps, {
        planId,
        deviceToken: ben.newDeviceToken,
        choice,
        displayName,
        mayNotifyHost: false,
      });
    expect(await update("interested", "Benjamin")).toEqual({
      kind: "updated",
      notifiedHost: false,
    });
    expect(await update("joined", "Benjamin")).toEqual({ kind: "limited" });
    expect(await viewMyResponse(deps, { planId, deviceToken: ben.newDeviceToken })).toMatchObject({
      response: { kind: "interested", displayName: "Benjamin" },
    });
  });

  it("allows renaming but not switching after the start", async () => {
    const ben = await joined();
    clock.set("2026-06-07T06:00:00Z");
    expect(
      await updateMyResponse(deps, {
        planId,
        deviceToken: ben.newDeviceToken,
        choice: "interested",
        displayName: "Ben",
      }),
    ).toEqual({
      kind: "closed",
      reason: "plan_started",
    });
    expect(
      await updateMyResponse(deps, {
        planId,
        deviceToken: ben.newDeviceToken,
        choice: "joined",
        displayName: "Benjamin",
      }),
    ).toEqual({
      kind: "updated",
      notifiedHost: false,
    });
  });

  it("validates names and keeps removed people out", async () => {
    const ben = await joined();
    expect(
      await updateMyResponse(deps, {
        planId,
        deviceToken: ben.newDeviceToken,
        choice: "joined",
        displayName: "Anna",
      }),
    ).toEqual({
      kind: "invalid",
      errors: [{ field: "displayName", code: "name_taken_by_host" }],
    });
    const response = await repos.responses.findByManageTokenHash(deps.tokens.hash(ben.manageToken));
    if (response === undefined) throw new Error("missing");
    await repos.responses.update({ ...response, kind: "removed", previousKind: "joined" });
    expect(
      await updateMyResponse(deps, {
        planId,
        deviceToken: ben.newDeviceToken,
        choice: "joined",
        displayName: "Ben",
      }),
    ).toEqual({
      kind: "blocked",
    });
  });

  it("withdraws with a hard delete, which also lifts a block (spec 3.5 Blocks and erasure)", async () => {
    const ben = await joined();
    expect(await withdrawMyResponse(deps, { planId, deviceToken: ben.newDeviceToken })).toEqual({
      kind: "withdrawn",
    });
    expect(
      await repos.responses.findByManageTokenHash(deps.tokens.hash(ben.manageToken)),
    ).toBeUndefined();
    expect(await withdrawMyResponse(deps, { planId, deviceToken: ben.newDeviceToken })).toEqual({
      kind: "not_found",
    });
  });
});

describe("manage link (spec 3.2, decision D1)", () => {
  it("asks for confirmation without state change, then links the device", async () => {
    const ben = await joined();
    expect(await openManageLink(deps, { token: ben.manageToken, deviceToken: undefined })).toEqual({
      kind: "confirm",
      id: planId,
      title: "Easy Sunday run",
    });
    const linked = await confirmManageLink(deps, {
      token: ben.manageToken,
      deviceToken: undefined,
    });
    expect(linked).toMatchObject({
      kind: "linked",
      id: planId,
      newDeviceToken: expect.any(String),
    });
    if (linked.kind !== "linked") return;
    expect(
      await viewMyResponse(deps, { planId, deviceToken: linked.newDeviceToken }),
    ).toMatchObject({ kind: "found" });
    expect(
      await openManageLink(deps, { token: ben.manageToken, deviceToken: linked.newDeviceToken }),
    ).toEqual({
      kind: "already_linked",
      id: planId,
    });
  });

  it("rejects unknown tokens", async () => {
    expect(await openManageLink(deps, { token: "nope", deviceToken: undefined })).toEqual({
      kind: "not_found",
    });
    expect(await confirmManageLink(deps, { token: "nope", deviceToken: undefined })).toEqual({
      kind: "not_found",
    });
  });
});
