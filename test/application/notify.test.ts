// Notification switches and the events that notify (spec 6 feature 3, decision D17).
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { notificationStatus, subscribe, unsubscribe } from "../../src/application/channels.ts";
import {
  acceptRequest,
  cancelPlan,
  editPlan,
  rejectRequest,
  removePerson,
} from "../../src/application/host.ts";
import { createPlan, type PlanDeps } from "../../src/application/plans.ts";
import { respond, withdrawMyResponse } from "../../src/application/responses.ts";
import { removeRoute, setRoute } from "../../src/application/routes.ts";
import { planToInput } from "../../src/domain/plan-edit.ts";
import { FakeChannelRepository } from "../fakes/channels.ts";
import { FakeClock } from "../fakes/clock.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { FakeJobQueue } from "../fakes/job-queue.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { fakeGpx, FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

const KEYS = { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) };
const subscription = (name: string) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
  keys: KEYS,
});

let deps: PlanDeps;
let repos: ReturnType<typeof createFakeRepositories>;
let channels: FakeChannelRepository;
let jobs: FakeJobQueue;
let planId: string;
let host: string | undefined;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;

beforeEach(async () => {
  repos = createFakeRepositories();
  channels = new FakeChannelRepository();
  jobs = new FakeJobQueue();
  deps = {
    ...repos,
    routeParser: new FakeRouteParser(),
    tokens: new FakeTokenService(),
    ids: new SequentialIdGenerator(),
    clock: new FakeClock(fixtureNow),
    limits: { horizonDays: 180, maxRetentionDays: 30 },
    notify: { channels, jobs },
  };
  const created = await createPlan(deps, {
    input: { ...sampleInput, joinMode: "approval" },
    units: "metric",
    language: "de",
    creationNonce: nonce(),
    deviceToken: undefined,
  });
  if (created.kind !== "created") throw new Error("setup failed");
  planId = created.planId;
  host = created.newDeviceToken;
});

async function responder(name: string, choice: string, language = "fr") {
  const result = await respond(deps, {
    planId,
    choice,
    displayName: name,
    requestNote: "",
    language,
    creationNonce: nonce(),
    deviceToken: undefined,
  });
  if (result.kind !== "created") throw new Error(`respond failed: ${result.kind}`);
  const response = await repos.responses.findByManageTokenHash(
    deps.tokens.hash(result.manageToken),
  );
  return { device: result.newDeviceToken, responseId: response?.id ?? "" };
}

/** The notifications queued so far, as "kind language owner". */
const queued = () =>
  [...jobs.jobs.values()].map((job) => {
    const payload = job.payload as {
      channelId: string;
      notification: { kind: string; language: string };
    };
    return `${payload.notification.kind} ${payload.notification.language} ${payload.channelId}`;
  });

describe("notification switches (spec 6 feature 3, decision D17)", () => {
  it("subscribe this browser for one's own response or as host, and report the state", async () => {
    const { device } = await responder("Ben", "requested");
    const asResponder = { planId, deviceToken: device, role: "responder" as const };
    expect(await subscribe(deps, { ...asResponder, subscription: subscription("ben") })).toEqual({
      kind: "subscribed",
    });
    expect(
      await notificationStatus(deps, { ...asResponder, endpoint: subscription("ben").endpoint }),
    ).toEqual({
      kind: "status",
      enabled: true,
    });
    await unsubscribe(deps, { ...asResponder, endpoint: subscription("ben").endpoint });
    expect(
      await notificationStatus(deps, { ...asResponder, endpoint: subscription("ben").endpoint }),
    ).toEqual({
      kind: "status",
      enabled: false,
    });

    expect(
      await subscribe(deps, {
        planId,
        deviceToken: host,
        role: "host",
        subscription: subscription("anna"),
      }),
    ).toEqual({ kind: "subscribed" });
    expect(channels.channels.size).toBe(1);
  });

  it("refuse strangers, the wrong role and foreign push endpoints", async () => {
    const { device } = await responder("Ben", "requested");
    expect(
      (
        await subscribe(deps, {
          planId,
          deviceToken: undefined,
          role: "responder",
          subscription: subscription("x"),
        })
      ).kind,
    ).toBe("not_found");
    expect(
      (
        await subscribe(deps, {
          planId,
          deviceToken: device,
          role: "host",
          subscription: subscription("x"),
        })
      ).kind,
    ).toBe("forbidden");
    expect(
      (
        await subscribe(deps, {
          planId,
          deviceToken: device,
          role: "responder",
          subscription: { endpoint: "https://evil.example/x", keys: KEYS },
        })
      ).kind,
    ).toBe("invalid");
    expect(channels.channels.size).toBe(0);
  });

  it("keep at most five browsers per person, replacing the oldest (spec 3.11)", async () => {
    const { device, responseId } = await responder("Ben", "requested");
    for (const name of ["a", "b", "c", "d", "e", "f"]) {
      await subscribe(deps, {
        planId,
        deviceToken: device,
        role: "responder",
        subscription: subscription(name),
      });
    }
    const endpoints = (await channels.listFor({ responseId })).map((c) => c.subscription.endpoint);
    expect(endpoints).toEqual(["b", "c", "d", "e", "f"].map((name) => subscription(name).endpoint));
  });

  it("let rejected people turn notifications off, but not on again (spec 3.5)", async () => {
    const rex = await responder("Rex", "requested");
    const asRex = { planId, deviceToken: rex.device, role: "responder" as const };
    await subscribe(deps, { ...asRex, subscription: subscription("rex") });
    await rejectRequest(deps, { planId, deviceToken: host, responseId: rex.responseId });

    expect((await subscribe(deps, { ...asRex, subscription: subscription("new") })).kind).toBe(
      "forbidden",
    );
    const endpoint = subscription("rex").endpoint;
    expect(await notificationStatus(deps, { ...asRex, endpoint })).toEqual({
      kind: "status",
      enabled: true,
    });
    expect(await unsubscribe(deps, { ...asRex, endpoint })).toEqual({ kind: "unsubscribed" });
    expect(channels.channels.size).toBe(0);
  });
});

describe("what notifies whom (spec 6 feature 3)", () => {
  async function subscribed(name: string, choice: string) {
    const person = await responder(name, choice);
    await subscribe(deps, {
      planId,
      deviceToken: person.device,
      role: "responder",
      subscription: subscription(name),
    });
    return person;
  }
  const subscribeHost = () =>
    subscribe(deps, {
      planId,
      deviceToken: host,
      role: "host",
      subscription: subscription("anna"),
    });

  it("tells the host about new requests, new responses and withdrawals, in the host's language", async () => {
    await subscribeHost();
    const ben = await responder("Ben", "requested");
    await responder("Ida", "interested");
    await withdrawMyResponse(deps, { planId, deviceToken: ben.device });
    expect(queued()).toEqual([
      "newRequest de channel-1",
      "newResponse de channel-1",
      "withdrawn de channel-1",
    ]);
  });

  it("tells requesters whether they were accepted or rejected, in their language", async () => {
    const ben = await subscribed("Ben", "requested");
    const rex = await subscribed("Rex", "requested");
    await acceptRequest(deps, { planId, deviceToken: host, responseId: ben.responseId });
    await rejectRequest(deps, { planId, deviceToken: host, responseId: rex.responseId });
    expect(queued()).toEqual(["accepted fr channel-1", "rejected fr channel-2"]);
  });

  it("tells everyone still in about changes and cancellation, but not rejected or removed people", async () => {
    const ben = await subscribed("Ben", "requested");
    const rex = await subscribed("Rex", "requested");
    const ida = await subscribed("Ida", "interested");
    await rejectRequest(deps, { planId, deviceToken: host, responseId: rex.responseId });
    await removePerson(deps, { planId, deviceToken: host, responseId: ida.responseId });
    jobs.jobs.clear();

    const plan = await repos.plans.findById(planId);
    if (plan === undefined) throw new Error("missing plan");
    await editPlan(deps, {
      planId,
      deviceToken: host,
      input: { ...planToInput(plan, "metric"), title: "Renamed" },
      units: "metric",
      confirmDeleteNow: false,
    });
    await cancelPlan(deps, { planId, deviceToken: host });
    expect(queued()).toEqual(["changed fr channel-1", "cancelled fr channel-1"]);
    expect(ben.responseId).not.toBe("");
  });

  it("stays quiet when a save changed nothing", async () => {
    await subscribed("Ben", "requested");
    jobs.jobs.clear();
    const plan = await repos.plans.findById(planId);
    if (plan === undefined) throw new Error("missing plan");
    await editPlan(deps, {
      planId,
      deviceToken: host,
      input: planToInput(plan, "metric"),
      units: "metric",
      confirmDeleteNow: false,
    });
    expect(queued()).toEqual([]);
  });

  it("tells pending requesters they were accepted when the plan switches to open mode", async () => {
    await subscribed("Ben", "requested");
    jobs.jobs.clear();
    const plan = await repos.plans.findById(planId);
    if (plan === undefined) throw new Error("missing plan");
    await editPlan(deps, {
      planId,
      deviceToken: host,
      input: { ...planToInput(plan, "metric"), joinMode: "open" },
      units: "metric",
      confirmDeleteNow: false,
      confirmAcceptPending: 1,
    });
    expect(queued()).toContain("accepted fr channel-1");
  });

  it("tells everyone still in when the route is added, replaced or removed (spec 3.1)", async () => {
    await subscribed("Ben", "requested");
    jobs.jobs.clear();
    const gpx = fakeGpx({
      segments: [
        [
          { lat: 48.16, lng: 11.6 },
          { lat: 48.17, lng: 11.6 },
        ],
      ],
    });
    expect((await setRoute(deps, { planId, deviceToken: host, gpx })).kind).toBe("saved");
    expect((await removeRoute(deps, { planId, deviceToken: host })).kind).toBe("removed");
    expect(queued()).toEqual(["changed fr channel-1", "changed fr channel-1"]);
  });

  it("never put the exact start into a notification (spec 3.6)", async () => {
    await subscribeHost();
    const ben = await subscribed("Ben", "requested");
    const rex = await subscribed("Rex", "requested");
    await acceptRequest(deps, { planId, deviceToken: host, responseId: ben.responseId });
    await rejectRequest(deps, { planId, deviceToken: host, responseId: rex.responseId });
    const plan = await repos.plans.findById(planId);
    if (plan === undefined) throw new Error("missing plan");
    await editPlan(deps, {
      planId,
      deviceToken: host,
      input: { ...planToInput(plan, "metric"), exactDescription: "Moved to the south gate" },
      units: "metric",
      confirmDeleteNow: false,
    });
    await cancelPlan(deps, { planId, deviceToken: host });

    expect(queued()).toContain("changed fr channel-2");
    const sent = JSON.stringify([...jobs.jobs.values()].map((job) => job.payload));
    for (const secret of ["North gate", "south gate", "48.16321", "11.60147"]) {
      expect(sent).not.toContain(secret);
    }
  });

  it("ties every job to its response or plan, so deleting them removes the jobs (spec 3.10)", async () => {
    await subscribeHost();
    const ben = await subscribed("Ben", "requested");
    await acceptRequest(deps, { planId, deviceToken: host, responseId: ben.responseId });
    const owners = [...jobs.jobs.values()].map((job) => [job.planId, job.responseId]);
    expect(owners).toEqual([
      [planId, undefined],
      [planId, ben.responseId],
    ]);
  });
});
