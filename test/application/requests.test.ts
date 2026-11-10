// Joining on approval (spec 3.4, 3.5, 6 feature 1).
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  acceptRequest,
  editPlan,
  rejectRequest,
  restorePerson,
  viewHostPage,
} from "../../src/application/host.ts";
import { createPlan, type PlanDeps, viewPlan } from "../../src/application/plans.ts";
import { respond, updateMyResponse, viewMyResponse } from "../../src/application/responses.ts";
import { planToInput } from "../../src/domain/plan-edit.ts";
import { FakeClock } from "../fakes/clock.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

let deps: PlanDeps;
let repos: ReturnType<typeof createFakeRepositories>;
let planId: string;
let host: string | undefined;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;

beforeEach(async () => {
  repos = createFakeRepositories();
  deps = {
    ...repos,
    routeParser: new FakeRouteParser(),
    tokens: new FakeTokenService(),
    ids: new SequentialIdGenerator(),
    clock: new FakeClock(fixtureNow),
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
});

async function request(name: string, choice = "requested", requestNote = "") {
  const result = await respond(deps, {
    planId,
    choice,
    displayName: name,
    requestNote,
    language: "en",
    creationNonce: nonce(),
    deviceToken: undefined,
  });
  if (result.kind !== "created") return { result, responseId: "", device: undefined };
  const response = await repos.responses.findByManageTokenHash(
    deps.tokens.hash(result.manageToken),
  );
  return { result, responseId: response?.id ?? "", device: result.newDeviceToken };
}

const kindOf = async (responseId: string) => (await repos.responses.findById(responseId))?.kind;
const as = (responseId: string) => ({ planId, deviceToken: host, responseId });

describe("requests (spec 3.4 approval mode)", () => {
  it("are created with an optional note that only the host sees", async () => {
    const { responseId } = await request("Ben", "requested", "I run 5:30 pace.");
    expect(await kindOf(responseId)).toBe("requested");
    const page = await viewHostPage(deps, { planId, deviceToken: host, units: "metric" });
    expect(page).toMatchObject({
      kind: "found",
      people: { requests: [{ responseId, name: "Ben", note: "I run 5:30 pace." }] },
    });
  });

  it("replace joining directly; interested stays possible", async () => {
    expect((await request("Ben", "joined")).result.kind).toBe("bad_request");
    expect(await kindOf((await request("Ida", "interested")).responseId)).toBe("interested");
  });

  it("are refused in open mode, as are notes there", async () => {
    await editPlan(deps, {
      planId,
      deviceToken: host,
      input: { ...planToInput((await repos.plans.findById(planId))!, "metric"), joinMode: "open" },
      units: "metric",
      confirmDeleteNow: false,
    });
    expect((await request("Ben", "requested")).result.kind).toBe("bad_request");
    expect((await request("Ida", "joined", "a note")).result.kind).toBe("bad_request");
  });

  it("show the requester only what interested people see until accepted (acceptance criterion)", async () => {
    const { responseId, device } = await request("Ben");
    expect((await viewPlan(deps, { planId, deviceToken: device })).kind).toBe("responder");
    await acceptRequest(deps, as(responseId));
    expect(await kindOf(responseId)).toBe("joined");
    expect((await viewPlan(deps, { planId, deviceToken: device })).kind).toBe("participant");
  });

  it("once rejected, keep the device out, also for a new request", async () => {
    const { responseId, device } = await request("Ben");
    expect(await rejectRequest(deps, as(responseId))).toEqual({ kind: "rejected" });
    expect((await viewPlan(deps, { planId, deviceToken: device })).kind).toBe("responder");
    const again = await respond(deps, {
      planId,
      choice: "requested",
      displayName: "Ben",
      requestNote: "",
      language: "en",
      creationNonce: nonce(),
      deviceToken: device,
    });
    expect(again.kind).toBe("blocked");
  });

  it("can only be accepted or rejected by the host, and only while pending", async () => {
    const { responseId } = await request("Ben");
    expect((await acceptRequest(deps, { ...as(responseId), deviceToken: undefined })).kind).toBe(
      "forbidden",
    );
    await acceptRequest(deps, as(responseId));
    expect(await rejectRequest(deps, as(responseId))).toEqual({ kind: "not_allowed" });
  });

  it("undoing a rejection returns the person to pending (spec 3.5)", async () => {
    const { responseId } = await request("Ben");
    await rejectRequest(deps, as(responseId));
    await restorePerson(deps, as(responseId));
    expect(await kindOf(responseId)).toBe("requested");
  });
});

describe("changing the join mode (spec 3.4)", () => {
  const edit = async (joinMode: string, confirmAcceptPending?: number) =>
    editPlan(deps, {
      planId,
      deviceToken: host,
      input: { ...planToInput((await repos.plans.findById(planId))!, "metric"), joinMode },
      units: "metric",
      confirmDeleteNow: false,
      confirmAcceptPending,
    });

  it("to open asks first how many pending requests will be accepted, then accepts them", async () => {
    const ben = await request("Ben");
    const ida = await request("Ida");
    const rejected = await request("Rex");
    await rejectRequest(deps, as(rejected.responseId));

    expect(await edit("open")).toEqual({ kind: "confirm_accept_pending", count: 2 });
    expect((await repos.plans.findById(planId))?.joinMode).toBe("approval");

    expect(await edit("open", 2)).toEqual({ kind: "updated" });
    expect((await repos.plans.findById(planId))?.joinMode).toBe("open");
    expect([await kindOf(ben.responseId), await kindOf(ida.responseId)]).toEqual([
      "joined",
      "joined",
    ]);
    expect(await kindOf(rejected.responseId)).toBe("rejected");
  });

  it("asks again when the number of pending requests changed since the host was asked", async () => {
    await request("Ben");
    expect(await edit("open")).toEqual({ kind: "confirm_accept_pending", count: 1 });
    await request("Ida");
    expect(await edit("open", 1)).toEqual({ kind: "confirm_accept_pending", count: 2 });
    expect((await repos.plans.findById(planId))?.joinMode).toBe("approval");
  });

  it("to approval keeps existing participants", async () => {
    await edit("open");
    const ben = await request("Ben", "joined");
    expect(await edit("approval")).toEqual({ kind: "updated" });
    expect(await kindOf(ben.responseId)).toBe("joined");
  });
});

describe("changing one's own response in approval mode (spec 3.4)", () => {
  it("switches between interested and requested; joining needs a new request", async () => {
    const { responseId, device } = await request("Ben", "interested");
    const update = (choice: string) =>
      updateMyResponse(deps, { planId, deviceToken: device, choice, displayName: "Ben" });
    expect(await update("requested")).toEqual({ kind: "updated", notifiedHost: true });
    expect(await kindOf(responseId)).toBe("requested");
    expect(await update("joined")).toEqual({ kind: "bad_request" });
    await acceptRequest(deps, as(responseId));
    expect(await update("joined")).toEqual({ kind: "updated", notifiedHost: false });
    expect(await update("interested")).toEqual({ kind: "updated", notifiedHost: false });
    expect(await update("requested")).toEqual({ kind: "updated", notifiedHost: true });
    expect(await kindOf(responseId)).toBe("requested");
  });
});

describe("the host's plan view", () => {
  it("counts pending requests, which the participant count leaves out (spec 3.5)", async () => {
    await request("Ben");
    const view = await viewPlan(deps, { planId, deviceToken: host });
    expect(view).toMatchObject({
      kind: "poster",
      view: { pendingRequests: 1, counts: { participants: 0, interested: 0 } },
    });
  });
});

describe("after the start (spec 3.1)", () => {
  it("refuses deciding pending requests, which the requester sees as not answered", async () => {
    const { responseId, device } = await request("Ben");
    (deps.clock as FakeClock).set("2026-06-07T05:30:00Z");
    expect(await acceptRequest(deps, as(responseId))).toEqual({ kind: "not_allowed" });
    expect(await rejectRequest(deps, as(responseId))).toEqual({ kind: "not_allowed" });
    expect(await viewMyResponse(deps, { planId, deviceToken: device })).toMatchObject({
      response: { kind: "requested", notAnswered: true },
      canChange: false,
    });
    const page = await viewHostPage(deps, { planId, deviceToken: host, units: "metric" });
    expect(page).toMatchObject({ requestsOpen: false });
  });
});

describe("request notes (spec 3.6)", () => {
  it("are dropped when the person stops requesting", async () => {
    const { responseId, device } = await request("Ben", "requested", "first note");
    await updateMyResponse(deps, {
      planId,
      deviceToken: device,
      choice: "interested",
      displayName: "Ben",
    });
    expect((await repos.responses.findById(responseId))?.requestNote).toBeUndefined();
  });

  it("are dropped once the host decided", async () => {
    const { responseId } = await request("Ben", "requested", "a note");
    await acceptRequest(deps, as(responseId));
    expect((await repos.responses.findById(responseId))?.requestNote).toBeUndefined();
  });
});
