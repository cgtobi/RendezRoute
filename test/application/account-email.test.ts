// The account's own address, lending it to plans and responses, the expiry warning, and "Email me
// my links" (spec 7 Optional notification channels, 3.10; decisions D31, I52; plan v1.0 step 6b).
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { exportAccountData, warnExpiringAccounts } from "../../src/application/account-data.ts";
import { type AccountDeps, finishLogin, startLogin } from "../../src/application/accounts.ts";
import {
  accountEmailSetting,
  emailSetting,
  requestAccountEmail,
  turnOffAccountEmail,
  useAccountEmail,
} from "../../src/application/email.ts";
import {
  accountNoticeHandler,
  channelConfirmationHandler,
  openChannelLink,
  useChannelLink,
} from "../../src/application/channel-links.ts";
import { emailNewLink, newLinkAddress } from "../../src/application/links.ts";
import { requestAccountNtfy } from "../../src/application/ntfy.ts";
import { requestAccountTelegram, startTelegramChat } from "../../src/application/telegram.ts";
import { removePerson } from "../../src/application/host.ts";
import { createPlan } from "../../src/application/plans.ts";
import type { ProviderAccount } from "../../src/application/ports.ts";
import { respond } from "../../src/application/responses.ts";
import { openManageLink, openTemplateLink } from "../../src/application/secret-links.ts";
import { saveAsTemplate } from "../../src/application/templates.ts";
import { FakeChannelLinks } from "../fakes/channel-links.ts";
import { FakeChannelRepository } from "../fakes/channels.ts";
import { FakeClock } from "../fakes/clock.ts";
import { FakeIdentityProvider } from "../fakes/identity-provider.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { FakeJobQueue } from "../fakes/job-queue.ts";
import { FakeOutbox } from "../fakes/outbox.ts";
import { FakeSentReminders } from "../fakes/reminders.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const links = new FakeChannelLinks();
const anna: ProviderAccount = { subject: "https://id.example.org anna", names: ["Anna"] };

let deps: AccountDeps;
let provider: FakeIdentityProvider;
let channels: FakeChannelRepository;
let jobs: FakeJobQueue;
let outbox: FakeOutbox;
let clock: FakeClock;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;

beforeEach(() => {
  provider = new FakeIdentityProvider();
  channels = new FakeChannelRepository();
  jobs = new FakeJobQueue();
  outbox = new FakeOutbox();
  clock = new FakeClock(fixtureNow);
  deps = {
    ...createFakeRepositories(),
    routeParser: new FakeRouteParser(),
    tokens: new FakeTokenService(),
    ids: new SequentialIdGenerator(),
    clock,
    limits: { horizonDays: 180, maxRetentionDays: 30 },
    postingMode: "anyone",
    identityLookup: { hash: (value) => `hmac(${value})` },
    identityProviders: { oidc: provider },
    fediverse: { servers: undefined, allowInsecure: false },
    notify: {
      channels,
      jobs,
      reminders: new FakeSentReminders(),
      links,
      email: { outbox, reportAlerts: false },
    },
  };
});

/** Logs a new device in; returns its token. */
async function logIn(account = anna, deviceToken?: string): Promise<string> {
  const started = await startLogin(deps, { provider: "oidc" });
  if (started.kind !== "redirect") throw new Error("not started");
  const done = await finishLogin(deps, {
    provider: "oidc",
    callback: provider.approve(started.authorizationUrl, account),
    cookieState: started.state,
    deviceToken,
  });
  if (done.kind !== "logged_in" || done.newDeviceToken === undefined) throw new Error("login");
  return done.newDeviceToken;
}

/** Runs the queued jobs of one type through its handler. */
async function run(type: "channelConfirmation" | "accountNotice") {
  const handle =
    type === "channelConfirmation" ? channelConfirmationHandler(deps) : accountNoticeHandler(deps);
  for (const [id, job] of jobs.jobs) {
    if (job.type !== type) continue;
    jobs.jobs.delete(id);
    await handle(job.payload);
  }
}

/** Sets and confirms the account's address on this device. */
async function accountAddress(device: string, address = "anna@example.org", language = "de") {
  await requestAccountEmail(deps, { deviceToken: device, address, language });
  const channel = [...channels.channels.values()].find(
    (c) => c.kind === "email" && "identityId" in c.owner && c.address === address,
  );
  await useChannelLink(deps, { token: links.tokenFor(channel?.id ?? ""), action: "confirm" });
  return channel?.id ?? "";
}

describe("the account's address (decision D31)", () => {
  it("is set and confirmed like any other, and its emails are about the account", async () => {
    expect(await accountEmailSetting(deps, { deviceToken: undefined })).toEqual({
      kind: "unavailable",
    });
    const device = await logIn();
    expect(await accountEmailSetting(deps, { deviceToken: device })).toEqual({
      kind: "setting",
      state: "off",
      accountAddress: undefined,
    });
    await requestAccountEmail(deps, {
      deviceToken: device,
      address: "anna@example.org",
      language: "de",
    });
    await run("channelConfirmation");
    // In the language the address was set in: an account has none of its own.
    expect(outbox.sent).toEqual(["confirm anna@example.org account de"]);
    const id = [...channels.channels.keys()][0] ?? "";
    expect(await openChannelLink(deps, links.tokenFor(id))).toEqual({
      kind: "confirm",
      channel: "email",
      subject: { kind: "account" },
      address: "a…@example.org",
    });
    await useChannelLink(deps, { token: links.tokenFor(id), action: "confirm" });
    expect(await accountEmailSetting(deps, { deviceToken: device })).toEqual({
      kind: "setting",
      state: "on",
      address: "anna@example.org",
      sending: true,
    });
    await turnOffAccountEmail(deps, { deviceToken: device });
    expect(channels.channels.size).toBe(0);
  });

  it("is lent to the account's plans and responses once confirmed, without confirming again", async () => {
    const device = await logIn();
    const hosting = { planId: "", deviceToken: device, role: "host" as const };
    const created = await createPlan(deps, {
      input: sampleInput,
      units: "metric",
      language: "en",
      creationNonce: nonce(),
      deviceToken: device,
    });
    if (created.kind !== "created") throw new Error("plan");
    hosting.planId = created.planId;

    // Not while it waits for confirmation.
    await requestAccountEmail(deps, {
      deviceToken: device,
      address: "anna@example.org",
      language: "de",
    });
    expect(await emailSetting(deps, hosting)).toMatchObject({ accountAddress: undefined });
    expect(await useAccountEmail(deps, hosting)).toEqual({ kind: "unavailable" });

    await accountAddress(device);
    expect(await emailSetting(deps, hosting)).toMatchObject({
      state: "off",
      accountAddress: "anna@example.org",
    });
    jobs.jobs.clear();
    expect(await useAccountEmail(deps, hosting)).toEqual({ kind: "set" });
    expect(await channels.emailFor({ planId: created.planId })).toMatchObject({
      address: "anna@example.org",
      verified: true,
    });
    expect([...jobs.jobs.values()].filter((job) => job.type === "channelConfirmation")).toEqual([]);

    // Another browser that is not logged in gets no offer.
    const visitor = await respond(deps, {
      planId: created.planId,
      choice: "joined",
      displayName: "Ben",
      requestNote: "",
      language: "en",
      creationNonce: nonce(),
      deviceToken: undefined,
    });
    if (visitor.kind !== "created") throw new Error("respond");
    const asBen = {
      planId: created.planId,
      deviceToken: visitor.newDeviceToken,
      role: "responder" as const,
    };
    expect(await emailSetting(deps, asBen)).toMatchObject({ accountAddress: undefined });
    expect(await useAccountEmail(deps, asBen)).toEqual({ kind: "unavailable" });
  });
});

describe("the expiry warning (spec 3.10, decision I52)", () => {
  it("reaches every confirmed account address 14 days before, once", async () => {
    const device = await logIn();
    await accountAddress(device);
    const lastActive = clock.now();
    const deleteAt = new Date(lastActive.getTime() + 365 * DAY_MS);

    clock.set(new Date(lastActive.getTime() + 350 * DAY_MS).toISOString());
    expect(await warnExpiringAccounts(deps)).toBe(0);
    clock.set(new Date(lastActive.getTime() + 351 * DAY_MS + 60_000).toISOString());
    expect(await warnExpiringAccounts(deps)).toBe(1);
    expect(await warnExpiringAccounts(deps)).toBe(0);
    await run("accountNotice");
    expect(outbox.sent.filter((line) => line.startsWith("expiry"))).toEqual([
      `expiry anna@example.org ${deleteAt.toISOString()} de`,
    ]);
  });

  it("is sent to no account without a confirmed address", async () => {
    const device = await logIn();
    await requestAccountEmail(deps, {
      deviceToken: device,
      address: "anna@example.org",
      language: "de",
    });
    clock.set(new Date(fixtureNow.getTime() + 352 * DAY_MS).toISOString());
    expect(await warnExpiringAccounts(deps)).toBe(0);
    expect([...jobs.jobs.values()].filter((job) => job.type === "accountNotice")).toEqual([]);
  });

  it("still comes when SMTP is turned on within the 14 days", async () => {
    const device = await logIn();
    await accountAddress(device);
    clock.set(new Date(fixtureNow.getTime() + 352 * DAY_MS).toISOString());
    const withSmtp = deps.notify;
    deps = {
      ...deps,
      notify: withSmtp && { ...withSmtp, links, email: { outbox: undefined, reportAlerts: false } },
    };
    expect(await warnExpiringAccounts(deps)).toBe(0);
    // The next day, with SMTP: nothing was marked, so the warning follows.
    deps = { ...deps, notify: withSmtp };
    clock.set(new Date(clock.now().getTime() + DAY_MS).toISOString());
    expect(await warnExpiringAccounts(deps)).toBe(1);
  });

  it("deletes an address refused for good, like a notification does (decision I54)", async () => {
    const device = await logIn();
    const id = await accountAddress(device);
    clock.set(new Date(fixtureNow.getTime() + 352 * DAY_MS).toISOString());
    expect(await warnExpiringAccounts(deps)).toBe(1);
    outbox.result = "gone";
    await run("accountNotice");
    expect(channels.channels.has(id)).toBe(false);
  });

  it("is not sent for an account already due for deletion", async () => {
    const device = await logIn();
    await accountAddress(device);
    clock.set(new Date(fixtureNow.getTime() + 366 * DAY_MS).toISOString());
    expect(await warnExpiringAccounts(deps)).toBe(0);
  });

  it("is dropped when the account was used after it was queued", async () => {
    const device = await logIn();
    await accountAddress(device);
    clock.set(new Date(fixtureNow.getTime() + 352 * DAY_MS).toISOString());
    expect(await warnExpiringAccounts(deps)).toBe(1);
    clock.set(new Date(clock.now().getTime() + 60 * 60 * 1000).toISOString());
    await logIn(anna, device);
    await run("accountNotice");
    expect(outbox.sent.filter((line) => line.startsWith("expiry"))).toEqual([]);
  });

  it("comes again after the account was used and left unused once more", async () => {
    const device = await logIn();
    await accountAddress(device);
    clock.set(new Date(fixtureNow.getTime() + 352 * DAY_MS).toISOString());
    expect(await warnExpiringAccounts(deps)).toBe(1);
    // Used again, a little later: logging in counts (I52).
    clock.set(new Date(clock.now().getTime() + 60 * 60 * 1000).toISOString());
    await logIn(anna, device);
    const used = clock.now();
    clock.set(new Date(used.getTime() + 352 * DAY_MS).toISOString());
    expect(await warnExpiringAccounts(deps)).toBe(1);
  });
});

describe("the expiry warning by ntfy (decision D33)", () => {
  it("reaches the account's confirmed topic too, in the language it was set up in", async () => {
    const sent: string[] = [];
    const ntfyOutbox = {
      confirmation: () => Promise.resolve("sent" as const),
      accountExpiry: (to: { topic: string; language: string }) => (
        sent.push(`expiry ${to.topic} ${to.language}`),
        Promise.resolve("sent" as const)
      ),
    };
    deps = {
      ...deps,
      notify: deps.notify && {
        ...deps.notify,
        ntfy: { outbox: ntfyOutbox, server: new URL("https://ntfy.example.org/") },
      },
    };
    const device = await logIn();
    await requestAccountNtfy(deps, { deviceToken: device, language: "fr" });
    const channel = [...channels.channels.values()].find((c) => c.kind === "ntfy");
    await useChannelLink(deps, { token: links.tokenFor(channel?.id ?? ""), action: "confirm" });
    clock.set(new Date(fixtureNow.getTime() + 352 * DAY_MS).toISOString());
    expect(await warnExpiringAccounts(deps)).toBe(1);
    await run("accountNotice");
    expect(sent).toEqual([`expiry ${channel?.kind === "ntfy" ? channel.topic : ""} fr`]);
  });
});

describe("the expiry warning by Telegram (decision D34)", () => {
  it("reaches the account's linked chat, in the language it was connected in", async () => {
    const sent: string[] = [];
    const telegramOutbox = {
      confirmation: () => Promise.resolve("sent" as const),
      accountExpiry: (to: { chatId: string; language: string }) => (
        sent.push(`expiry ${to.chatId} ${to.language}`),
        Promise.resolve("sent" as const)
      ),
    };
    deps = {
      ...deps,
      notify: deps.notify && {
        ...deps.notify,
        telegram: { outbox: telegramOutbox, botName: () => "isar_runs_bot" },
      },
    };
    const device = await logIn();
    await requestAccountTelegram(deps, { deviceToken: device, language: "de" });
    const channel = [...channels.channels.values()].find((c) => c.kind === "telegram");
    await startTelegramChat(deps, {
      startToken: links.startTokenFor(channel?.id ?? ""),
      chatId: "77",
    });
    clock.set(new Date(fixtureNow.getTime() + 352 * DAY_MS).toISOString());
    expect(await warnExpiringAccounts(deps)).toBe(1);
    await run("accountNotice");
    expect(sent).toEqual(["expiry 77 de"]);
    // In the account export (spec 3.7), like the account's address.
    const exported = await exportAccountData(deps, { deviceToken: device });
    expect(exported.kind === "found" && exported.data.account?.telegramChat).toBe("77");
  });

  it("deletes the chat when the bot was blocked (decision D34)", async () => {
    deps = {
      ...deps,
      notify: deps.notify && {
        ...deps.notify,
        telegram: {
          outbox: {
            confirmation: () => Promise.resolve("sent" as const),
            accountExpiry: () => Promise.resolve("gone" as const),
          },
          botName: () => "isar_runs_bot",
        },
      },
    };
    const device = await logIn();
    await requestAccountTelegram(deps, { deviceToken: device, language: "de" });
    const channel = [...channels.channels.values()].find((c) => c.kind === "telegram");
    await startTelegramChat(deps, {
      startToken: links.startTokenFor(channel?.id ?? ""),
      chatId: "77",
    });
    clock.set(new Date(fixtureNow.getTime() + 352 * DAY_MS).toISOString());
    expect(await warnExpiringAccounts(deps)).toBe(1);
    await run("accountNotice");
    expect(channels.channels.has(channel?.id ?? "")).toBe(false);
  });
});

describe("Email me my links (decision D31)", () => {
  async function respondWithAddress(confirm: boolean) {
    const created = await createPlan(deps, {
      input: sampleInput,
      units: "metric",
      language: "en",
      creationNonce: nonce(),
      deviceToken: undefined,
    });
    if (created.kind !== "created") throw new Error("plan");
    const responded = await respond(deps, {
      planId: created.planId,
      choice: "joined",
      displayName: "Ben",
      requestNote: "",
      language: "fr",
      creationNonce: nonce(),
      deviceToken: undefined,
    });
    if (responded.kind !== "created") throw new Error("respond");
    const response = await deps.responses.findByManageTokenHash(
      deps.tokens.hash(responded.manageToken),
    );
    const id = await channels.setEmail({ responseId: response?.id ?? "" }, "ben@example.org");
    if (confirm) await channels.confirm(id);
    return { created, responded };
  }

  const request = (planId: string, deviceToken: string | undefined) => ({
    kind: "manage" as const,
    id: planId,
    deviceToken,
    formNonce: nonce(),
    linkUrl: (token: string) => `https://runs.example.org/m/${token}`,
  });

  it("sends a new link to the confirmed address, and the old one stops working", async () => {
    const { created, responded } = await respondWithAddress(true);
    const device = responded.newDeviceToken;
    expect(
      await newLinkAddress(deps, { kind: "manage", id: created.planId, deviceToken: device }),
    ).toBe("ben@example.org");
    expect(await emailNewLink(deps, request(created.planId, device))).toEqual({
      kind: "sent",
      address: "ben@example.org",
    });
    expect(outbox.sent).toEqual([`newLink ben@example.org ${sampleInput.title}`]);
    const emailed = outbox.links.get("ben@example.org")?.split("/m/")[1] ?? "";
    expect(
      (await openManageLink(deps, { token: responded.manageToken, deviceToken: undefined })).kind,
    ).toBe("not_found");
    expect((await openManageLink(deps, { token: emailed, deviceToken: undefined })).kind).toBe(
      "confirm",
    );
  });

  it("changes nothing when the email could not be sent", async () => {
    const { created, responded } = await respondWithAddress(true);
    outbox.result = "retry";
    expect(await emailNewLink(deps, request(created.planId, responded.newDeviceToken))).toEqual({
      kind: "not_sent",
    });
    expect(
      (await openManageLink(deps, { token: responded.manageToken, deviceToken: undefined })).kind,
    ).toBe("confirm");
  });

  it("is not offered to rejected or removed people (spec 3.5)", async () => {
    const { created, responded } = await respondWithAddress(true);
    const response = await deps.responses.findByManageTokenHash(
      deps.tokens.hash(responded.manageToken),
    );
    await removePerson(deps, {
      planId: created.planId,
      deviceToken: created.newDeviceToken,
      responseId: response?.id ?? "",
    });
    const device = responded.newDeviceToken;
    expect(
      await newLinkAddress(deps, { kind: "manage", id: created.planId, deviceToken: device }),
    ).toBeUndefined();
    expect(await emailNewLink(deps, request(created.planId, device))).toEqual({
      kind: "no_address",
    });
    expect(outbox.sent).toEqual([]);
  });

  it("is not offered without a confirmed address, nor without SMTP", async () => {
    const { created, responded } = await respondWithAddress(false);
    const device = responded.newDeviceToken;
    expect(
      await newLinkAddress(deps, { kind: "manage", id: created.planId, deviceToken: device }),
    ).toBeUndefined();
    expect(await emailNewLink(deps, request(created.planId, device))).toEqual({
      kind: "no_address",
    });
    expect(outbox.sent).toEqual([]);
    expect(
      (await openManageLink(deps, { token: responded.manageToken, deviceToken: undefined })).kind,
    ).toBe("confirm");
  });

  it("sends a template's link to the account's address; not to other devices' requests", async () => {
    const device = await logIn();
    await accountAddress(device);
    outbox.sent.length = 0;
    const created = await createPlan(deps, {
      input: sampleInput,
      units: "metric",
      language: "en",
      creationNonce: nonce(),
      deviceToken: device,
    });
    if (created.kind !== "created") throw new Error("plan");
    const saved = await saveAsTemplate(deps, {
      planId: created.planId,
      deviceToken: device,
      includePrivate: false,
      creationNonce: nonce(),
    });
    if (saved.kind !== "saved") throw new Error("template");
    const template = { ...request(saved.templateId, device), kind: "template" as const };
    expect(await emailNewLink(deps, template)).toEqual({
      kind: "sent",
      address: "anna@example.org",
    });
    expect(
      (await openTemplateLink(deps, { token: saved.hostToken, deviceToken: undefined })).kind,
    ).toBe("not_found");
    expect(
      await emailNewLink(deps, { ...template, deviceToken: undefined, formNonce: nonce() }),
    ).toEqual({
      kind: "forbidden",
    });
  });
});
