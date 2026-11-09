// The recap (spec 6 features 5–7, decision I42).
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { subscribe } from "../../src/application/channels.ts";
import { acceptRequest, cancelPlan, editPlan, removePerson } from "../../src/application/host.ts";
import { createPlan, type PlanDeps, viewPlan } from "../../src/application/plans.ts";
import {
  addContribution,
  deleteContribution,
  deleteRecap,
  editContribution,
  setContributionHidden,
  viewOwnContribution,
} from "../../src/application/recap.ts";
import { respond } from "../../src/application/responses.ts";
import { planToInput } from "../../src/domain/plan-edit.ts";
import { CONTRIBUTION_LIMITS } from "../../src/domain/recap.ts";
import { FakeChannelRepository } from "../fakes/channels.ts";
import { FakeClock } from "../fakes/clock.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { FakeJobQueue } from "../fakes/job-queue.ts";
import { FakeSentReminders } from "../fakes/reminders.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

// sampleInput starts on 7 June 2026 at 07:30 in Berlin (05:30 UTC); 14 days, recap 1 week.
const STARTED = "2026-06-07T06:00:00Z";

let deps: PlanDeps;
let repos: ReturnType<typeof createFakeRepositories>;
let clock: FakeClock;
let jobs: FakeJobQueue;
let planId: string;
let host: string | undefined;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;

beforeEach(async () => {
  repos = createFakeRepositories();
  clock = new FakeClock(fixtureNow);
  jobs = new FakeJobQueue();
  deps = {
    ...repos,
    routeParser: new FakeRouteParser(),
    tokens: new FakeTokenService(),
    ids: new SequentialIdGenerator(),
    clock,
    limits: { horizonDays: 180, maxRetentionDays: 30 },
    notify: { channels: new FakeChannelRepository(), jobs, reminders: new FakeSentReminders() },
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

async function person(name: string, choice: "interested" | "requested" | "joined") {
  const result = await respond(deps, {
    planId,
    choice: choice === "joined" ? "requested" : choice,
    displayName: name,
    requestNote: "",
    language: "en",
    creationNonce: nonce(),
    deviceToken: undefined,
  });
  if (result.kind !== "created") throw new Error(`respond failed: ${result.kind}`);
  const response = await repos.responses.findByManageTokenHash(
    deps.tokens.hash(result.manageToken),
  );
  const responseId = response?.id ?? "";
  if (choice === "joined") await acceptRequest(deps, { planId, deviceToken: host, responseId });
  return { responseId, device: result.newDeviceToken };
}

const add = (deviceToken: string | undefined, body = "Great run!", linkUrl = "") =>
  addContribution(deps, { planId, deviceToken, body, linkUrl });

async function recapOf(deviceToken: string | undefined) {
  const result = await viewPlan(deps, { planId, deviceToken });
  if (result.kind === "poster" || result.kind === "participant") return result.view.recap;
  return result.kind;
}

const contributionIds = async () => (await repos.recap.listByPlan(planId)).map((c) => c.id);

describe("adding to the recap (spec 6 feature 5)", () => {
  it("is for participants and the host while the recap is open", async () => {
    const ben = await person("Ben", "joined");
    const ida = await person("Ida", "interested");
    const pia = await person("Pia", "requested");
    expect(await add(ben.device)).toEqual({ kind: "closed" });
    clock.set(STARTED);
    expect(await add(ben.device)).toEqual({ kind: "added" });
    expect(await add(host)).toEqual({ kind: "added" });
    expect(await add(ida.device)).toEqual({ kind: "forbidden" });
    expect(await add(pia.device)).toEqual({ kind: "forbidden" });
    expect(await add(undefined)).toEqual({ kind: "forbidden" });
    clock.set("2026-06-14T05:30:00Z");
    expect(await add(ben.device)).toEqual({ kind: "closed" });
  });

  it("checks the contribution and the per-person limit", async () => {
    const ben = await person("Ben", "joined");
    clock.set(STARTED);
    expect(await add(ben.device, " ", "")).toEqual({
      kind: "invalid",
      errors: [{ field: "body", code: "contribution_empty" }],
    });
    for (let i = 0; i < CONTRIBUTION_LIMITS.perPerson; i++) await add(ben.device);
    expect(await add(ben.device)).toEqual({ kind: "limit_reached" });
    expect(await add(host)).toEqual({ kind: "added" });
  });

  it("is not possible for cancelled plans", async () => {
    const ben = await person("Ben", "joined");
    await cancelPlan(deps, { planId, deviceToken: host });
    clock.set(STARTED);
    expect(await add(ben.device)).toEqual({ kind: "closed" });
    expect(await recapOf(ben.device)).toBeUndefined();
  });
});

describe("the recap as participants and the host see it", () => {
  it("lists contributions with their authors, oldest first, only from the start on", async () => {
    const ben = await person("Ben", "joined");
    expect(await recapOf(ben.device)).toBeUndefined();
    clock.set(STARTED);
    await add(ben.device, "Lovely morning", "https://www.strava.com/activities/1");
    clock.advance({ minutes: 1 });
    await add(host, "Thanks all");
    const recap = await recapOf(ben.device);
    expect(recap).toMatchObject({
      open: true,
      closesAt: new Date("2026-06-14T05:30:00Z"),
      canContribute: true,
      contributions: [
        {
          authorName: "Ben",
          byHost: false,
          body: "Lovely morning",
          linkUrl: "https://www.strava.com/activities/1",
          own: true,
          hidden: false,
        },
        { authorName: "Anna", byHost: true, body: "Thanks all", own: false },
      ],
    });
  });

  it("is not part of what interested and pending people see (spec 3.6)", async () => {
    const ben = await person("Ben", "joined");
    const ida = await person("Ida", "interested");
    clock.set(STARTED);
    await add(ben.device);
    expect(await recapOf(ida.device)).toBe("responder");
    expect(await recapOf(undefined)).toBe("viewer");
  });

  it("shows hidden contributions only to the host and their author (decision I42)", async () => {
    const ben = await person("Ben", "joined");
    const lea = await person("Lea", "joined");
    clock.set(STARTED);
    await add(ben.device, "Hide me");
    const [id = ""] = await contributionIds();
    expect(
      await setContributionHidden(deps, {
        planId,
        contributionId: id,
        deviceToken: ben.device,
        hidden: true,
      }),
    ).toEqual({ kind: "forbidden" });
    await setContributionHidden(deps, {
      planId,
      contributionId: id,
      deviceToken: host,
      hidden: true,
    });
    const visible = async (device: string | undefined) => {
      const recap = await recapOf(device);
      return typeof recap === "object"
        ? recap.contributions.map((c) => `${c.body} ${c.hidden}`)
        : [];
    };
    expect(await visible(lea.device)).toEqual([]);
    expect(await visible(ben.device)).toEqual(["Hide me true"]);
    expect(await visible(host)).toEqual(["Hide me true"]);
    await setContributionHidden(deps, {
      planId,
      contributionId: id,
      deviceToken: host,
      hidden: false,
    });
    expect(await visible(lea.device)).toEqual(["Hide me false"]);
  });
});

describe("own contributions (spec 6 feature 5: editable and deletable at any time)", () => {
  it("can be edited and deleted by their author only, also after the recap closed", async () => {
    const ben = await person("Ben", "joined");
    const lea = await person("Lea", "joined");
    clock.set(STARTED);
    await add(ben.device, "Frist try");
    const [contributionId = ""] = await contributionIds();
    const request = (deviceToken: string | undefined) => ({ planId, contributionId, deviceToken });
    clock.set("2026-06-20T00:00:00Z");
    expect(await viewOwnContribution(deps, request(ben.device))).toEqual({
      kind: "found",
      body: "Frist try",
      linkUrl: "",
    });
    expect(await viewOwnContribution(deps, request(host))).toEqual({ kind: "forbidden" });
    expect(
      await editContribution(deps, { ...request(lea.device), body: "Mine now", linkUrl: "" }),
    ).toEqual({ kind: "forbidden" });
    expect(
      await editContribution(deps, { ...request(ben.device), body: "First try", linkUrl: "" }),
    ).toEqual({ kind: "updated" });
    expect((await repos.recap.findById(contributionId))?.body).toBe("First try");
    expect(await deleteContribution(deps, request(host))).toEqual({ kind: "forbidden" });
    expect(await deleteContribution(deps, request(ben.device))).toEqual({ kind: "deleted" });
    expect(await contributionIds()).toEqual([]);
  });

  it("are deleted when their author is removed (spec 3.5)", async () => {
    const ben = await person("Ben", "joined");
    clock.set(STARTED);
    await add(ben.device);
    await add(host);
    await removePerson(deps, { planId, deviceToken: host, responseId: ben.responseId });
    expect((await repos.recap.listByPlan(planId)).map((c) => c.responseId)).toEqual([undefined]);
  });
});

describe("deleting the recap (spec 6 feature 7)", () => {
  it("removes every contribution and tells participants with a channel", async () => {
    const ben = await person("Ben", "joined");
    await subscribe(deps, {
      planId,
      deviceToken: ben.device,
      role: "responder",
      subscription: {
        endpoint: "https://fcm.googleapis.com/fcm/send/ben",
        keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
      },
    });
    clock.set(STARTED);
    await add(ben.device);
    await add(host);
    jobs.jobs.clear();
    expect(await deleteRecap(deps, { planId, deviceToken: ben.device })).toEqual({
      kind: "forbidden",
    });
    expect(await deleteRecap(deps, { planId, deviceToken: host })).toEqual({
      kind: "deleted",
      count: 2,
    });
    expect(await contributionIds()).toEqual([]);
    expect(
      [...jobs.jobs.values()].map(
        (job) => (job.payload as { notification: { kind: string } }).notification.kind,
      ),
    ).toEqual(["recapDeleted"]);
    jobs.jobs.clear();
    await deleteRecap(deps, { planId, deviceToken: host });
    expect(jobs.jobs.size).toBe(0);
  });
});

describe("the recap window (spec 6 feature 6)", () => {
  it("can be closed by the host after the start; existing contributions stay", async () => {
    const ben = await person("Ben", "joined");
    clock.set(STARTED);
    await add(ben.device);
    const plan = await repos.plans.findById(planId);
    if (plan === undefined) throw new Error("missing");
    const edited = await editPlan(deps, {
      planId,
      deviceToken: host,
      input: { ...planToInput(plan, "metric"), recapWindow: "now" },
      units: "metric",
      confirmDeleteNow: false,
    });
    expect(edited).toEqual({ kind: "updated" });
    expect(await add(ben.device)).toEqual({ kind: "closed" });
    const recap = await recapOf(ben.device);
    expect(typeof recap === "object" && recap.open).toBe(false);
    expect(typeof recap === "object" && recap.contributions).toHaveLength(1);
  });

  it("reopens for a day from the change", async () => {
    const ben = await person("Ben", "joined");
    const plan = await repos.plans.findById(planId);
    if (plan === undefined) throw new Error("missing");
    await editPlan(deps, {
      planId,
      deviceToken: host,
      input: { ...planToInput(plan, "metric"), recapWindow: "now" },
      units: "metric",
      confirmDeleteNow: false,
    });
    clock.set("2026-06-09T00:00:00Z");
    expect(await add(ben.device)).toEqual({ kind: "closed" });
    const closed = await repos.plans.findById(planId);
    if (closed === undefined) throw new Error("missing");
    await editPlan(deps, {
      planId,
      deviceToken: host,
      input: { ...planToInput(closed, "metric"), recapWindow: "1d" },
      units: "metric",
      confirmDeleteNow: false,
    });
    expect(await add(ben.device)).toEqual({ kind: "added" });
    clock.set("2026-06-10T00:00:00Z");
    expect(await add(ben.device)).toEqual({ kind: "closed" });
  });
});
