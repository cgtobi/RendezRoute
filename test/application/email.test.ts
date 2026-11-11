// Email notifications for responses and hosted plans (spec 7 Optional notification channels,
// decision D31): confirmed before first use, turned off from every message.
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  emailSetting,
  reportAlertHandler,
  requestEmail,
  turnOffEmail,
} from "../../src/application/email.ts";
import {
  channelConfirmationHandler,
  openChannelLink,
  useChannelLink,
} from "../../src/application/channel-links.ts";
import { subscribe } from "../../src/application/channels.ts";
import { removePerson } from "../../src/application/host.ts";
import { notificationHandler } from "../../src/application/notifications.ts";
import { notifyHost, notifyResponders, deletionNotices } from "../../src/application/notify.ts";
import { createPlan, type PlanDeps } from "../../src/application/plans.ts";
import { reportPlan } from "../../src/application/reports.ts";
import { respond } from "../../src/application/responses.ts";
import { FakeChannelLinks } from "../fakes/channel-links.ts";
import { FakeChannelRepository } from "../fakes/channels.ts";
import { FakeClock } from "../fakes/clock.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { FakeJobQueue } from "../fakes/job-queue.ts";
import { FakeNotifier } from "../fakes/notifier.ts";
import { FakeOutbox } from "../fakes/outbox.ts";
import { FakeSentReminders } from "../fakes/reminders.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

let deps: PlanDeps;
let repos: ReturnType<typeof createFakeRepositories>;
let channels: FakeChannelRepository;
let jobs: FakeJobQueue;
let planId: string;
let host: string | undefined;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;
const links = new FakeChannelLinks();

let outbox: FakeOutbox;

/** `sending: false`: SMTP not configured (or switched off later), so there is no outbox. */
function setup(
  email: { sending: boolean; reportAlerts: boolean } = { sending: true, reportAlerts: true },
) {
  outbox = new FakeOutbox();
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
    postingMode: "anyone",
    notify: {
      channels,
      jobs,
      reminders: new FakeSentReminders(),
      links,
      email: {
        outbox: email.sending ? outbox : undefined,
        reportAlerts: email.reportAlerts,
      },
    },
  };
}

beforeEach(async () => {
  setup();
  const created = await createPlan(deps, {
    input: sampleInput,
    units: "metric",
    language: "de",
    creationNonce: nonce(),
    deviceToken: undefined,
  });
  if (created.kind !== "created") throw new Error("setup failed");
  planId = created.planId;
  host = created.newDeviceToken;
});

async function responder(name: string, language = "fr") {
  const result = await respond(deps, {
    planId,
    choice: "joined",
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

/** The jobs queued so far, as "type target" (notifications also name their kind). */
function takeQueued(): string[] {
  const queued = [...jobs.jobs.values()].map((job) => {
    const payload = job.payload as {
      to?: { channelId?: string; email?: { address: string } };
      notification?: { kind: string };
      channelId?: string;
    };
    const target =
      payload.to?.email?.address ?? payload.to?.channelId ?? payload.channelId ?? "instance";
    return [job.type, payload.notification?.kind, target].filter(Boolean).join(" ");
  });
  jobs.jobs.clear();
  return queued;
}

const asHost = () => ({ planId, deviceToken: host, role: "host" as const });

describe("setting an address (decision D31)", () => {
  it("keeps it unconfirmed and sends only the confirmation link", async () => {
    const { device, responseId } = await responder("Ben");
    const asBen = { planId, deviceToken: device, role: "responder" as const };
    expect(await emailSetting(deps, asBen)).toEqual({
      kind: "setting",
      state: "off",
      accountAddress: undefined,
    });
    takeQueued();

    expect(await requestEmail(deps, { ...asBen, address: " Ben@Example.ORG " })).toEqual({
      kind: "sent",
    });
    const channel = await channels.emailFor({ responseId });
    expect(channel?.address).toBe("Ben@example.org");
    expect(await emailSetting(deps, asBen)).toEqual({
      kind: "setting",
      state: "pending",
      address: "Ben@example.org",
      sending: true,
    });
    const [confirmation] = [...jobs.jobs.values()];
    // Tied to the response, so withdrawing removes the queued confirmation too (spec 3.10).
    expect(confirmation?.responseId).toBe(responseId);
    expect(takeQueued()).toEqual([`channelConfirmation ${channel?.id}`]);

    // No mail before confirmation: the host's change reaches nobody by email.
    await notifyResponders(deps, (await repos.plans.findById(planId))!, "changed");
    expect(takeQueued()).toEqual([]);
  });

  it("refuses addresses that are not one plain address", async () => {
    const { device } = await responder("Ben");
    const asBen = { planId, deviceToken: device, role: "responder" as const };
    expect(
      await requestEmail(deps, { ...asBen, address: "ben@example.org, eve@example.org" }),
    ).toEqual({ kind: "invalid", error: "email_invalid" });
    expect(await requestEmail(deps, { ...asBen, address: "" })).toEqual({
      kind: "invalid",
      error: "required",
    });
    expect(takeQueued()).toEqual([]);
  });

  it("is only for one's own response or hosted plan, and not for removed people", async () => {
    const { device, responseId } = await responder("Ben");
    const stranger = { planId, deviceToken: undefined, role: "responder" as const };
    expect(await requestEmail(deps, { ...stranger, address: "x@example.org" })).toEqual({
      kind: "not_found",
    });
    expect(
      await requestEmail(deps, {
        planId,
        deviceToken: device,
        role: "host",
        address: "x@example.org",
      }),
    ).toEqual({ kind: "forbidden" });
    await removePerson(deps, { planId, deviceToken: host, responseId });
    expect(
      await requestEmail(deps, {
        planId,
        deviceToken: device,
        role: "responder",
        address: "ben@example.org",
      }),
    ).toEqual({ kind: "forbidden" });
  });

  it("does nothing without SMTP", async () => {
    setup({ sending: false, reportAlerts: false });
    const created = await createPlan(deps, {
      input: sampleInput,
      units: "metric",
      language: "de",
      creationNonce: nonce(),
      deviceToken: undefined,
    });
    if (created.kind !== "created") throw new Error("setup failed");
    const request = {
      planId: created.planId,
      deviceToken: created.newDeviceToken,
      role: "host" as const,
    };
    expect(await emailSetting(deps, request)).toEqual({ kind: "unavailable" });
    expect(await requestEmail(deps, { ...request, address: "anna@example.org" })).toEqual({
      kind: "unavailable",
    });
  });
});

describe("the email's link (decision D31, spec 3.2: no change on GET)", () => {
  it("confirms the address on request, then turns the emails off", async () => {
    await requestEmail(deps, { ...asHost(), address: "anna@example.org" });
    const channel = await channels.emailFor({ planId });
    const token = links.tokenFor(channel?.id ?? "");
    expect(await openChannelLink(deps, token)).toEqual({
      kind: "confirm",
      channel: "email",
      subject: { kind: "plan", planTitle: sampleInput.title },
      address: "a…@example.org",
    });
    expect((await channels.emailFor({ planId }))?.verified).toBe(false);

    expect(await useChannelLink(deps, { token, action: "confirm" })).toEqual({
      kind: "confirmed",
      channel: "email",
    });
    expect(await emailSetting(deps, asHost())).toEqual({
      kind: "setting",
      state: "on",
      address: "anna@example.org",
      sending: true,
    });
    takeQueued();
    await notifyHost(deps, (await repos.plans.findById(planId))!, "newResponse");
    expect(takeQueued()).toEqual([`notification newResponse ${channel?.id}`]);

    expect(await openChannelLink(deps, token)).toEqual({
      kind: "turnOff",
      channel: "email",
      subject: { kind: "plan", planTitle: sampleInput.title },
      address: "a…@example.org",
    });
    expect(await useChannelLink(deps, { token, action: "off" })).toEqual({
      kind: "off",
      channel: "email",
    });
    expect(await channels.emailFor({ planId })).toBeUndefined();
    // Works without any device: the link alone is enough, and a second use finds nothing.
    expect(await openChannelLink(deps, token)).toEqual({ kind: "not_found" });
    expect(await useChannelLink(deps, { token, action: "off" })).toEqual({ kind: "not_found" });
  });

  it("refuses made-up links and a confirm for an address replaced since", async () => {
    expect(await openChannelLink(deps, "made-up")).toEqual({ kind: "not_found" });
    // Signed, but for a browser's push channel: such links are never sent and mean nothing.
    const push = await channels.add(
      { planId },
      { endpoint: "https://fcm.googleapis.com/fcm/send/a", keys: { p256dh: "B", auth: "A" } },
    );
    expect(await openChannelLink(deps, links.tokenFor(push))).toEqual({ kind: "not_found" });
    expect(await useChannelLink(deps, { token: links.tokenFor(push), action: "off" })).toEqual({
      kind: "not_found",
    });
    expect(await channels.findById(push)).toBeDefined();
    await requestEmail(deps, { ...asHost(), address: "anna@example.org" });
    const old = links.tokenFor((await channels.emailFor({ planId }))?.id ?? "");
    await requestEmail(deps, { ...asHost(), address: "anna.berg@example.org" });
    expect(await useChannelLink(deps, { token: old, action: "confirm" })).toEqual({
      kind: "not_found",
    });
    expect((await channels.emailFor({ planId }))?.verified).toBe(false);
  });

  it("can also be turned off from the page", async () => {
    await requestEmail(deps, { ...asHost(), address: "anna@example.org" });
    expect(await turnOffEmail(deps, asHost())).toEqual({ kind: "off" });
    expect(await emailSetting(deps, asHost())).toEqual({
      kind: "setting",
      state: "off",
      accountAddress: undefined,
    });
  });
});

describe("email next to push (decision D31)", () => {
  it("does not count against the five browsers, and goes with Sign out all other devices", async () => {
    const { device, responseId } = await responder("Ben");
    await requestEmail(deps, {
      planId,
      deviceToken: device,
      role: "responder",
      address: "b@example.org",
    });
    for (const name of ["a", "b", "c", "d", "e", "f"]) {
      await subscribe(deps, {
        planId,
        deviceToken: device,
        role: "responder",
        subscription: {
          endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
          keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
        },
      });
    }
    const kinds = (await channels.listFor({ responseId })).map((channel) => channel.kind);
    expect(kinds.filter((kind) => kind === "email")).toHaveLength(1);
    expect(kinds.filter((kind) => kind === "webpush")).toHaveLength(5);
  });

  it("sends deletion notices to confirmed addresses, carrying the address", async () => {
    const { device, responseId } = await responder("Ben");
    await requestEmail(deps, {
      planId,
      deviceToken: device,
      role: "responder",
      address: "ben@example.org",
    });
    const channel = await channels.emailFor({ responseId });
    await useChannelLink(deps, { token: links.tokenFor(channel?.id ?? ""), action: "confirm" });
    const { device: cleo } = await responder("Cleo");
    await requestEmail(deps, {
      planId,
      deviceToken: cleo,
      role: "responder",
      address: "cleo@example.org",
    });
    takeQueued();
    const send = await deletionNotices(deps, (await repos.plans.findById(planId))!);
    await send();
    // The job runner takes it and hands it to the notifier, the channel gone with the plan.
    const notifier = new FakeNotifier();
    const [job] = [...jobs.jobs.values()];
    expect(await notificationHandler({ notifier })(job?.payload)).toBe("done");
    expect(notifier.sent[0]?.to).toEqual({ email: { address: "ben@example.org" } });
    expect(takeQueued()).toEqual(["notification deleted ben@example.org"]);
  });

  it("carry the plan's public time and place for emails, never the exact start", async () => {
    await requestEmail(deps, { ...asHost(), address: "anna@example.org" });
    await useChannelLink(deps, {
      token: links.tokenFor((await channels.emailFor({ planId }))?.id ?? ""),
      action: "confirm",
    });
    takeQueued();
    const plan = (await repos.plans.findById(planId))!;
    await notifyHost(deps, plan, "newResponse");
    const [job] = [...jobs.jobs.values()];
    expect((job?.payload as { notification: unknown } | undefined)?.notification).toMatchObject({
      facts: {
        startsAt: plan.startsAt.toISOString(),
        timeZone: plan.timeZone,
        area: plan.area.label,
      },
    });
    expect(JSON.stringify(job?.payload)).not.toContain("North gate");
  });
});

describe("asking again (decision D31)", () => {
  it("sends the same link again while waiting, and changes nothing once confirmed", async () => {
    await requestEmail(deps, { ...asHost(), address: "anna@example.org" });
    const first = (await channels.emailFor({ planId }))?.id;
    takeQueued();
    expect(await requestEmail(deps, { ...asHost(), address: "anna@example.org" })).toEqual({
      kind: "sent",
    });
    expect((await channels.emailFor({ planId }))?.id).toBe(first);
    expect(takeQueued()).toEqual([`channelConfirmation ${first}`]);

    await useChannelLink(deps, { token: links.tokenFor(first ?? ""), action: "confirm" });
    expect(await requestEmail(deps, { ...asHost(), address: "anna@example.org" })).toEqual({
      kind: "unchanged",
    });
    expect((await channels.emailFor({ planId }))?.verified).toBe(true);
    expect(takeQueued()).toEqual([]);
  });

  it("lets whoever got the confirmation refuse it", async () => {
    await requestEmail(deps, { ...asHost(), address: "anna@example.org" });
    const token = links.tokenFor((await channels.emailFor({ planId }))?.id ?? "");
    expect(await useChannelLink(deps, { token, action: "off" })).toEqual({
      kind: "off",
      channel: "email",
    });
    expect(await channels.emailFor({ planId })).toBeUndefined();
  });
});

describe("rejected and removed people (spec 3.5)", () => {
  it("can no longer confirm an address, and get no confirmation link, but can turn it off", async () => {
    const { device, responseId } = await responder("Ben");
    await requestEmail(deps, {
      planId,
      deviceToken: device,
      role: "responder",
      address: "b@example.org",
    });
    const channel = await channels.emailFor({ responseId });
    const token = links.tokenFor(channel?.id ?? "");
    await removePerson(deps, { planId, deviceToken: host, responseId });

    expect((await openChannelLink(deps, token)).kind).toBe("turnOff");
    expect(await useChannelLink(deps, { token, action: "confirm" })).toEqual({ kind: "not_found" });
    expect((await channels.emailFor({ responseId }))?.verified).toBe(false);
    expect(await channelConfirmationHandler(deps)({ channelId: channel?.id })).toBe("drop");
    expect(outbox.sent).toEqual([]);
    expect(await useChannelLink(deps, { token, action: "off" })).toEqual({
      kind: "off",
      channel: "email",
    });
  });
});

describe("SMTP switched off later (decision D31)", () => {
  it("keeps stored addresses visible and removable, and sends nothing to them", async () => {
    await requestEmail(deps, { ...asHost(), address: "anna@example.org" });
    const id = (await channels.emailFor({ planId }))?.id ?? "";
    await useChannelLink(deps, { token: links.tokenFor(id), action: "confirm" });
    takeQueued();
    deps = {
      ...deps,
      notify: {
        channels,
        jobs,
        reminders: new FakeSentReminders(),
        links,
        email: { outbox: undefined, reportAlerts: false },
      },
    };

    expect(await emailSetting(deps, asHost())).toEqual({
      kind: "setting",
      state: "on",
      address: "anna@example.org",
      sending: false,
    });
    expect(await requestEmail(deps, { ...asHost(), address: "x@example.org" })).toEqual({
      kind: "unavailable",
    });
    // No job, so reminders are not marked as sent for an email that cannot go out.
    expect(await notifyHost(deps, (await repos.plans.findById(planId))!, "newResponse")).toBe(0);
    expect(takeQueued()).toEqual([]);
    // The link in an email sent before still turns them off.
    expect((await openChannelLink(deps, links.tokenFor(id))).kind).toBe("turnOff");
    expect(await useChannelLink(deps, { token: links.tokenFor(id), action: "off" })).toEqual({
      kind: "off",
      channel: "email",
    });
  });
});

describe("email jobs", () => {
  it("send the confirmation in the owner's language, only while it is unconfirmed", async () => {
    const { device } = await responder("Ben", "fr");
    await requestEmail(deps, {
      planId,
      deviceToken: device,
      role: "responder",
      address: "ben@example.org",
    });
    const [job] = [...jobs.jobs.values()].filter((queued) => queued.type === "channelConfirmation");
    const handle = channelConfirmationHandler(deps);
    expect(await handle(job?.payload)).toBe("done");
    expect(outbox.sent).toEqual([`confirm ben@example.org ${sampleInput.title} fr`]);

    const channel = [...channels.channels.values()].find((c) => c.kind === "email");
    await channels.confirm(channel?.id ?? "");
    expect(await handle(job?.payload)).toBe("drop");
    expect(await handle({ channelId: 42 })).toBe("drop");
    outbox.result = "retry";
    await channels.setEmail(channel?.owner ?? { planId }, "ben@example.org");
    const again = [...channels.channels.values()].find((c) => c.kind === "email");
    expect(await handle({ channelId: again?.id })).toBe("retry");
  });

  it("alert CONTACT_EMAIL about each new report, without its content", async () => {
    const report = (nonceValue: string) =>
      reportPlan(deps, {
        planId,
        deviceToken: undefined,
        reason: "spam",
        details: "SENTINEL-details",
        attach: [],
        nonce: nonceValue,
      });
    const once = nonce();
    await report(once);
    await report(once);
    const queued = [...jobs.jobs.values()].filter((job) => job.type === "reportAlert");
    expect(queued).toHaveLength(1);
    expect(JSON.stringify(queued)).not.toContain("SENTINEL");
    expect(queued[0]?.planId).toBe(planId);

    expect(await reportAlertHandler({ outbox })(queued[0]?.payload)).toBe("done");
    expect(outbox.sent).toEqual(["reportAlert"]);
  });

  it("send no report alerts when they are off", async () => {
    setup({ sending: true, reportAlerts: false });
    const created = await createPlan(deps, {
      input: sampleInput,
      units: "metric",
      language: "de",
      creationNonce: nonce(),
      deviceToken: undefined,
    });
    if (created.kind !== "created") throw new Error("setup failed");
    await reportPlan(deps, {
      planId: created.planId,
      deviceToken: undefined,
      reason: "spam",
      details: "",
      attach: [],
      nonce: nonce(),
    });
    expect(takeQueued()).toEqual([]);
  });
});
