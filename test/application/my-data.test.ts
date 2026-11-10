// "My data on this device" (spec 3.2, 3.7, decision I45).
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createCalendarFeed } from "../../src/application/calendar.ts";
import { subscribe } from "../../src/application/channels.ts";
import { acceptRequest } from "../../src/application/host.ts";
import { deleteMyData, exportMyData, viewMyData } from "../../src/application/my-data.ts";
import { createPlan, type PlanDeps } from "../../src/application/plans.ts";
import { ratePlan } from "../../src/application/ratings.ts";
import { addContribution } from "../../src/application/recap.ts";
import { respond } from "../../src/application/responses.ts";
import { saveAsTemplate } from "../../src/application/templates.ts";
import { FakeChannelRepository } from "../fakes/channels.ts";
import { FakeClock } from "../fakes/clock.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { FakeJobQueue } from "../fakes/job-queue.ts";
import { FakeSentReminders } from "../fakes/reminders.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

// sampleInput starts on 7 June 2026 at 07:30 in Berlin (05:30 UTC).
const STARTED = "2026-06-07T06:00:00Z";
const CLOSED = "2026-06-14T05:30:00Z";
const route = {
  segments: [
    [
      { lat: 48.1631, lng: 11.6014 },
      { lat: 48.17, lng: 11.61 },
    ],
  ],
};

let deps: PlanDeps;
let repos: ReturnType<typeof createFakeRepositories>;
let clock: FakeClock;
let jobs: FakeJobQueue;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;

beforeEach(() => {
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
    postingMode: "anyone",
    notify: { channels: new FakeChannelRepository(), jobs, reminders: new FakeSentReminders() },
  };
});

async function newPlan(input = {}) {
  const created = await createPlan(deps, {
    input: { ...sampleInput, joinMode: "approval", ...input },
    units: "metric",
    language: "en",
    creationNonce: nonce(),
    deviceToken: undefined,
  });
  if (created.kind !== "created") throw new Error("setup failed");
  await repos.plans.saveRoute(created.planId, route);
  return { planId: created.planId, host: created.newDeviceToken };
}

async function person(
  planId: string,
  host: string | undefined,
  name: string,
  choice: "interested" | "requested" | "joined",
  deviceToken?: string,
) {
  const result = await respond(deps, {
    planId,
    choice: choice === "interested" ? "interested" : "requested",
    displayName: name,
    requestNote: choice === "interested" ? "" : `${name}'s note`,
    language: "en",
    creationNonce: nonce(),
    deviceToken,
  });
  if (result.kind !== "created") throw new Error(`respond failed: ${result.kind}`);
  const device = deviceToken ?? result.newDeviceToken;
  if (choice === "joined") {
    const response = await repos.responses.findByManageTokenHash(
      deps.tokens.hash(result.manageToken),
    );
    await acceptRequest(deps, { planId, deviceToken: host, responseId: response?.id ?? "" });
  }
  return device;
}

describe("viewMyData", () => {
  it("lists what the device hosts, its responses, templates and calendar feed", async () => {
    const hosted = await newPlan({ title: "Hosted" });
    const other = await newPlan({ title: "Other" });
    await person(other.planId, other.host, "Lea", "interested", hosted.host);
    await saveAsTemplate(deps, {
      planId: hosted.planId,
      deviceToken: hosted.host,
      includePrivate: false,
      creationNonce: nonce(),
    });
    await createCalendarFeed(deps, { deviceToken: hosted.host, language: "en" });
    expect(await viewMyData(deps, { deviceToken: hosted.host })).toMatchObject({
      hosted: [{ planId: hosted.planId, title: "Hosted" }],
      responses: [{ planId: other.planId, title: "Other", responseKind: "interested" }],
      templates: [{ title: "Hosted" }],
      calendarFeed: true,
    });
    expect(await viewMyData(deps, { deviceToken: undefined })).toEqual({
      hosted: [],
      responses: [],
      templates: [],
      calendarFeed: false,
    });
  });
});

describe("exportMyData (spec 3.7)", () => {
  it("holds what each page shows: exact start, route and names only where visible", async () => {
    const { planId, host } = await newPlan();
    const ida = await person(planId, host, "Ida", "interested");
    const ben = await person(planId, host, "Ben", "joined");

    const hostExport = await exportMyData(deps, { deviceToken: host, scope: { kind: "device" } });
    if (hostExport.kind !== "found") throw new Error("no export");
    const [hosted] = hostExport.data.plans;
    expect(hosted).toMatchObject({
      role: "host",
      view: {
        exactStart: { description: "North gate, by the bike racks" },
        participants: [{ name: "Anna" }, { name: "Ben" }],
        interested: [{ name: "Ida" }],
      },
      route,
    });
    expect(JSON.stringify(hosted)).not.toContain("Ben's note");

    const idaExport = await exportMyData(deps, { deviceToken: ida, scope: { kind: "device" } });
    if (idaExport.kind !== "found") throw new Error("no export");
    const [response] = idaExport.data.plans;
    expect(response).toMatchObject({ role: "response", route: undefined });
    expect(response?.view).not.toHaveProperty("exactStart");
    expect(response?.view).not.toHaveProperty("participants");
    expect(JSON.stringify(response)).not.toContain("North gate");
    expect(response?.calendar.exactStart).toBeUndefined();

    const benExport = await exportMyData(deps, {
      deviceToken: ben,
      scope: { kind: "response", planId },
    });
    if (benExport.kind !== "found") throw new Error("no export");
    expect(benExport.data.plans[0]).toMatchObject({
      role: "response",
      route,
      calendar: { exactStart: { description: "North gate, by the bike racks" } },
    });

    // A pending request keeps its own note, which is exported to its author only.
    const max = await person(planId, host, "Max", "requested");
    const maxExport = await exportMyData(deps, {
      deviceToken: max,
      scope: { kind: "response", planId },
    });
    expect(maxExport.kind === "found" && maxExport.data.plans[0]?.requestNote).toBe("Max's note");
  });

  it("contains only one's own recap contributions (user decision 2026-11-09)", async () => {
    const { planId, host } = await newPlan();
    const ben = await person(planId, host, "Ben", "joined");
    clock.set(STARTED);
    await addContribution(deps, { planId, deviceToken: ben, body: "Ben's words", linkUrl: "" });
    await addContribution(deps, { planId, deviceToken: host, body: "Host's words", linkUrl: "" });
    const exported = await exportMyData(deps, {
      deviceToken: ben,
      scope: { kind: "response", planId },
    });
    if (exported.kind !== "found") throw new Error("no export");
    expect(exported.data.plans[0]?.ownContributions).toEqual([
      { body: "Ben's words", linkUrl: undefined, hidden: false },
    ]);
    expect(JSON.stringify(exported.data)).not.toContain("Host's words");
  });

  it("exports one plan for its host and one response for its owner, nothing else", async () => {
    const { planId, host } = await newPlan();
    const ida = await person(planId, host, "Ida", "interested");
    const plan = await exportMyData(deps, { deviceToken: host, scope: { kind: "hosted", planId } });
    expect(plan.kind === "found" && plan.data.plans).toHaveLength(1);
    expect(
      await exportMyData(deps, { deviceToken: ida, scope: { kind: "hosted", planId } }),
    ).toEqual({ kind: "not_found" });
    expect(
      await exportMyData(deps, { deviceToken: host, scope: { kind: "response", planId } }),
    ).toEqual({ kind: "not_found" });
    expect(await exportMyData(deps, { deviceToken: undefined, scope: { kind: "device" } })).toEqual(
      { kind: "not_found" },
    );
  });
});

describe("ratings in the export (spec 6a, 3.7)", () => {
  it("hold a participant's own rating, and the host's result once it shows", async () => {
    const { planId, host } = await newPlan();
    const ben = await person(planId, host, "Ben", "joined");
    const lea = await person(planId, host, "Lea", "joined");
    await person(planId, host, "Max", "joined");
    clock.set(STARTED);
    await ratePlan(deps, { planId, deviceToken: ben, value: "down", note: "SENTINEL-ben" });
    await ratePlan(deps, { planId, deviceToken: lea, value: "up", note: "" });
    const exportOf = async (device: string | undefined) => {
      const exported = await exportMyData(deps, { deviceToken: device, scope: { kind: "device" } });
      if (exported.kind !== "found") throw new Error("no export");
      return exported.data.plans.find((plan) => plan.view.id === planId);
    };
    expect(await exportOf(ben)).toMatchObject({
      ownRating: { value: "down", note: "SENTINEL-ben" },
      ratingResult: undefined,
    });
    expect(await exportOf(lea)).toMatchObject({ ownRating: { value: "up", note: undefined } });
    expect(JSON.stringify(await exportOf(lea))).not.toContain("SENTINEL-ben");
    const before = await exportOf(host);
    expect(before).toMatchObject({ role: "host" });
    expect(before?.ratingResult).toBeUndefined();

    clock.set(CLOSED);
    expect((await exportOf(host))?.ratingResult).toMatchObject({
      participants: 3,
      rated: 2,
      up: 1,
      down: 1,
      notes: [{ authorName: "Ben", value: "down", note: "SENTINEL-ben" }],
    });
    expect(JSON.stringify(await exportOf(lea))).not.toContain("SENTINEL-ben");
  });
});

describe("deleteMyData (spec 3.7)", () => {
  it("does not tell a host that someone they removed withdrew (decision I45)", async () => {
    const { planId, host } = await newPlan();
    await subscribe(deps, {
      planId,
      deviceToken: host,
      role: "host",
      subscription: {
        endpoint: "https://fcm.googleapis.com/fcm/send/host",
        keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
      },
    });
    const lea = await person(planId, host, "Lea", "joined");
    const response = (await repos.responses.listByPlan(planId)).find(
      (r) => r.displayName === "Lea",
    );
    if (response === undefined) throw new Error("no response");
    await repos.responses.update({ ...response, kind: "removed", previousKind: "joined" });
    jobs.jobs.clear();
    await deleteMyData(deps, { deviceToken: lea });
    expect(await repos.responses.findById(response.id)).toBeUndefined();
    expect([...jobs.jobs.values()].map((job) => JSON.stringify(job.payload))).toEqual([]);
  });

  it("deletes hosted plans with notices but no template, responses, templates and the device", async () => {
    const hosted = await newPlan({ keepAsTemplate: "1" });
    const ida = await person(hosted.planId, hosted.host, "Ida", "interested");
    await subscribe(deps, {
      planId: hosted.planId,
      deviceToken: ida,
      role: "responder",
      subscription: {
        endpoint: "https://fcm.googleapis.com/fcm/send/ida",
        keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
      },
    });
    const other = await newPlan({ title: "Other" });
    await person(other.planId, other.host, "Lea", "joined", hosted.host);
    await subscribe(deps, {
      planId: other.planId,
      deviceToken: other.host,
      role: "host",
      subscription: {
        endpoint: "https://fcm.googleapis.com/fcm/send/other-host",
        keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
      },
    });
    await saveAsTemplate(deps, {
      planId: hosted.planId,
      deviceToken: hosted.host,
      includePrivate: true,
      creationNonce: nonce(),
    });
    jobs.jobs.clear();

    expect(await deleteMyData(deps, { deviceToken: hosted.host })).toEqual({ kind: "deleted" });
    expect(await repos.plans.findById(hosted.planId)).toBeUndefined();
    expect(await repos.responses.listByPlan(other.planId)).toHaveLength(0);
    expect(await viewMyData(deps, { deviceToken: other.host })).toMatchObject({ templates: [] });
    // The other host and Ida stay; this device is gone.
    expect(repos.devices.all()).toHaveLength(2);
    expect(await viewMyData(deps, { deviceToken: hosted.host })).toMatchObject({ hosted: [] });
    // Ida was told the upcoming plan is gone; the other host that Lea withdrew.
    const queued = [...jobs.jobs.values()].map((job) => JSON.stringify(job.payload));
    expect(queued.some((p) => p.includes('"deleted"'))).toBe(true);
    expect(queued.some((p) => p.includes('"withdrawn"'))).toBe(true);
    expect(await deleteMyData(deps, { deviceToken: hosted.host })).toEqual({
      kind: "not_found",
    });
  });
});
