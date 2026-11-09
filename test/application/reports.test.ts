// Reporting a plan (spec 7 Moderation, decision I47).
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createPlan, type PlanDeps } from "../../src/application/plans.ts";
import { reportForm, reportPlan } from "../../src/application/reports.ts";
import { respond } from "../../src/application/responses.ts";
import { FakeChannelRepository } from "../fakes/channels.ts";
import { FakeClock } from "../fakes/clock.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { FakeJobQueue } from "../fakes/job-queue.ts";
import { FakeSentReminders } from "../fakes/reminders.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

// sampleInput starts on 7 June 2026; the recap is there from the start.
const AFTER_START = new Date("2026-06-07T06:00:00Z");

let deps: PlanDeps;
let clock: FakeClock;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;

beforeEach(() => {
  clock = new FakeClock(fixtureNow);
  deps = {
    ...createFakeRepositories(),
    routeParser: new FakeRouteParser(),
    tokens: new FakeTokenService(),
    ids: new SequentialIdGenerator(),
    clock,
    limits: { horizonDays: 180, maxRetentionDays: 30 },
    notify: {
      channels: new FakeChannelRepository(),
      jobs: new FakeJobQueue(),
      reminders: new FakeSentReminders(),
    },
  };
});

/** A started plan with a host post, a hidden post and a participant's post; returns the devices. */
async function planWithRecap() {
  const created = await createPlan(deps, {
    input: sampleInput,
    units: "metric",
    language: "en",
    creationNonce: nonce(),
    deviceToken: undefined,
  });
  if (created.kind !== "created") throw new Error("setup failed");
  const { planId } = created;
  const joined = async (name: string) => {
    const responded = await respond(deps, {
      planId,
      choice: "joined",
      displayName: name,
      requestNote: "",
      language: "en",
      creationNonce: nonce(),
      deviceToken: undefined,
    });
    if (responded.kind !== "created") throw new Error("respond failed");
    return responded;
  };
  const ben = await joined("Ben");
  await joined("Lea");
  const responseOf = async (name: string) => {
    const responses = await deps.responses.listByPlan(planId);
    return responses.find((response) => response.displayName === name)?.id;
  };
  clock.set(AFTER_START);
  let minute = 0;
  const post = (id: string, responseId: string | undefined, body: string, hidden = false) => {
    const at = new Date(AFTER_START.getTime() + ++minute * 60_000);
    return deps.recap.create({
      id,
      planId,
      responseId,
      body,
      linkUrl: undefined,
      hiddenByHost: hidden,
      createdAt: at,
      updatedAt: at,
    });
  };
  await post("post-host", undefined, "Host post");
  await post("post-ben", await responseOf("Ben"), "Ben's post");
  await post("post-lea-hidden", await responseOf("Lea"), "Lea's hidden post", true);
  return { planId, host: created.newDeviceToken, ben: ben.newDeviceToken };
}

const send = (
  planId: string,
  deviceToken: string | undefined,
  fields: Partial<{ reason: string; details: string; attach: string[]; nonce: string }> = {},
) =>
  reportPlan(deps, {
    planId,
    deviceToken,
    reason: "unsafe",
    details: "",
    attach: [],
    nonce: nonce(),
    ...fields,
  });

describe("reporting a plan (spec 7 Moderation)", () => {
  it("offers to attach exactly the recap posts the reporter can see", async () => {
    const { planId, host, ben } = await planWithRecap();
    const ids = async (deviceToken: string | undefined) => {
      const form = await reportForm(deps, { planId, deviceToken });
      return form.kind === "form" ? form.attachable.map((post) => post.id) : form.kind;
    };
    expect(await ids(ben)).toEqual(["post-host", "post-ben"]);
    expect(await ids(host)).toEqual(["post-host", "post-ben", "post-lea-hidden"]);
    expect(await ids(undefined)).toEqual([]);
    expect(await reportForm(deps, { planId: "nope", deviceToken: undefined })).toEqual({
      kind: "not_found",
    });
  });

  it("stores the reason, details and copies of the chosen posts, without authors or reporter", async () => {
    const { planId, ben } = await planWithRecap();
    const result = await send(planId, ben, {
      details: "  Meeting point is a building site  ",
      // A post Ben cannot see is not attached, even if its ID is sent.
      attach: ["post-ben", "post-lea-hidden", "post-host"],
    });
    expect(result).toEqual({ kind: "sent", created: true });
    const [report] = await deps.reports.listOpenForPlan(planId);
    expect(report).toEqual({
      id: expect.any(String),
      planId,
      reason: "unsafe",
      details: "Meeting point is a building site",
      attached: [
        { body: "Host post", linkUrl: undefined },
        { body: "Ben's post", linkUrl: undefined },
      ],
      createdAt: AFTER_START,
      resolvedAt: undefined,
    });
    expect(JSON.stringify(report)).not.toMatch(/Ben"|Anna|post-|device|token/);
  });

  it("keeps the copy when the post is later deleted", async () => {
    const { planId, ben } = await planWithRecap();
    await send(planId, ben, { attach: ["post-ben"] });
    await deps.recap.delete("post-ben");
    expect((await deps.reports.listOpenForPlan(planId))[0]?.attached).toEqual([
      { body: "Ben's post", linkUrl: undefined },
    ]);
  });

  it("lets anyone report, attaching nothing they cannot see", async () => {
    const { planId } = await planWithRecap();
    expect(await send(planId, undefined, { reason: "spam", attach: ["post-host"] })).toEqual({
      kind: "sent",
      created: true,
    });
    expect((await deps.reports.listOpenForPlan(planId))[0]?.attached).toEqual([]);
  });

  it("stores a form sent twice once", async () => {
    const { planId } = await planWithRecap();
    const once = nonce();
    expect(await send(planId, undefined, { nonce: once })).toEqual({ kind: "sent", created: true });
    expect(await send(planId, undefined, { nonce: once })).toEqual({
      kind: "sent",
      created: false,
    });
    expect(await deps.reports.listOpen()).toHaveLength(1);
  });

  it("refuses invalid input, a missing one-time value and unknown plans", async () => {
    const { planId } = await planWithRecap();
    const once = nonce();
    expect(await send(planId, undefined, { reason: "boring", nonce: once })).toEqual({
      kind: "invalid",
      errors: [{ field: "reason", code: "choice_invalid" }],
    });
    // The corrected form, with the same one-time value, is still stored.
    expect(await send(planId, undefined, { nonce: once })).toEqual({ kind: "sent", created: true });
    expect(await send(planId, undefined, { nonce: "short" })).toEqual({ kind: "bad_request" });
    expect(await send("nope", undefined)).toEqual({ kind: "not_found" });
    expect(await deps.reports.listOpen()).toHaveLength(1);
  });
});
