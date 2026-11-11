// Telegram for responses and hosted plans (spec 7 Optional notification channels, decision D34):
// confirmed by pressing Start in the bot through the page's deep link, turned off from every
// message, nothing sent before.
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { openChannelLink, useChannelLink } from "../../src/application/channel-links.ts";
import { removePerson } from "../../src/application/host.ts";
import { notificationHandler } from "../../src/application/notifications.ts";
import { deletionNotices, notifyResponders } from "../../src/application/notify.ts";
import { createPlan, type PlanDeps } from "../../src/application/plans.ts";
import type {
  ChannelSubject,
  SendResult,
  TelegramOutbox,
  TelegramRecipient,
} from "../../src/application/ports.ts";
import { respond } from "../../src/application/responses.ts";
import {
  requestTelegram,
  startTelegramChat,
  telegramSetting,
  turnOffTelegram,
} from "../../src/application/telegram.ts";
import { FakeChannelLinks } from "../fakes/channel-links.ts";
import { FakeChannelRepository } from "../fakes/channels.ts";
import { FakeClock } from "../fakes/clock.ts";
import { SequentialIdGenerator } from "../fakes/ids.ts";
import { FakeJobQueue } from "../fakes/job-queue.ts";
import { FakeNotifier } from "../fakes/notifier.ts";
import { FakeSentReminders } from "../fakes/reminders.ts";
import { createFakeRepositories } from "../fakes/repositories.ts";
import { FakeRouteParser } from "../fakes/route-parser.ts";
import { FakeTokenService } from "../fakes/tokens.ts";
import { fixtureNow, sampleInput } from "../fixtures/plans.ts";

const links = new FakeChannelLinks();

class FakeTelegramOutbox implements TelegramOutbox {
  readonly sent: string[] = [];
  result: SendResult = "sent";
  confirmation(to: TelegramRecipient, about: ChannelSubject) {
    this.sent.push(`on ${to.chatId} ${about.kind} ${to.language}`);
    return Promise.resolve(this.result);
  }
  accountExpiry(to: TelegramRecipient) {
    this.sent.push(`expiry ${to.chatId}`);
    return Promise.resolve("sent" as const);
  }
}

let deps: PlanDeps;
let repos: ReturnType<typeof createFakeRepositories>;
let channels: FakeChannelRepository;
let jobs: FakeJobQueue;
let outbox: FakeTelegramOutbox;
let botName: string | undefined;
let planId: string;
let host: string | undefined;
let n = 0;
const nonce = () => `nonce-${String(++n).padStart(16, "0")}`;

beforeEach(async () => {
  repos = createFakeRepositories();
  channels = new FakeChannelRepository();
  jobs = new FakeJobQueue();
  outbox = new FakeTelegramOutbox();
  botName = "isar_runs_bot";
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
      telegram: { outbox, botName: () => botName },
    },
  };
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

async function responder(name: string) {
  const result = await respond(deps, {
    planId,
    choice: "joined",
    displayName: name,
    requestNote: "",
    language: "fr",
    creationNonce: nonce(),
    deviceToken: undefined,
  });
  if (result.kind !== "created") throw new Error(`respond failed: ${result.kind}`);
  const response = await repos.responses.findByManageTokenHash(
    deps.tokens.hash(result.manageToken),
  );
  return {
    request: { planId, deviceToken: result.newDeviceToken, role: "responder" as const },
    responseId: response?.id ?? "",
  };
}

const queued = () =>
  [...jobs.jobs.values()]
    .filter((job) => job.type === "notification")
    .map((job) => {
      const payload = job.payload as {
        to: { channelId?: string; telegram?: { chatId: string } };
        notification: { kind: string };
      };
      return `${payload.notification.kind} ${payload.to.telegram?.chatId ?? payload.to.channelId}`;
    });

describe("connecting Telegram (decision D34)", () => {
  it("waits for Start through the deep link, sends nothing before, then confirms the chat", async () => {
    const { request, responseId } = await responder("Ben");
    expect(await telegramSetting(deps, request)).toEqual({ kind: "setting", state: "off" });
    expect(await requestTelegram(deps, request)).toEqual({ kind: "ready" });
    const channel = await channels.telegramFor({ responseId });
    expect(await telegramSetting(deps, request)).toEqual({
      kind: "setting",
      state: "pending",
      start: { botName: "isar_runs_bot", startToken: `start-${channel?.id}` },
    });
    await notifyResponders(deps, (await repos.plans.findById(planId))!, "changed");
    expect(queued()).toEqual([]);
    expect(outbox.sent).toEqual([]);

    expect(
      await startTelegramChat(deps, { startToken: `start-${channel?.id}`, chatId: "42" }),
    ).toEqual({
      kind: "confirmed",
    });
    // The bot's answer is the confirmation, in the owner's language.
    expect(outbox.sent).toEqual(["on 42 plan fr"]);
    expect(await telegramSetting(deps, request)).toEqual({
      kind: "setting",
      state: "on",
      sending: true,
    });
    await notifyResponders(deps, (await repos.plans.findById(planId))!, "changed");
    expect(queued()).toEqual([`changed ${channel?.id}`]);
  });

  it("ignores made-up codes, a second Start, and Start for someone removed since (spec 3.5)", async () => {
    const { request, responseId } = await responder("Ben");
    await requestTelegram(deps, request);
    const channel = await channels.telegramFor({ responseId });
    expect(await startTelegramChat(deps, { startToken: "start-made-up", chatId: "42" })).toEqual({
      kind: "ignored",
    });
    await removePerson(deps, { planId, deviceToken: host, responseId });
    expect(
      await startTelegramChat(deps, { startToken: `start-${channel?.id}`, chatId: "42" }),
    ).toEqual({ kind: "ignored" });
    expect(outbox.sent).toEqual([]);
    expect(await requestTelegram(deps, request)).toEqual({ kind: "forbidden" });
  });

  it("links only the first chat that presses Start", async () => {
    const { request, responseId } = await responder("Ben");
    await requestTelegram(deps, request);
    const code = `start-${(await channels.telegramFor({ responseId }))?.id}`;
    await startTelegramChat(deps, { startToken: code, chatId: "42" });
    expect(await startTelegramChat(deps, { startToken: code, chatId: "666" })).toEqual({
      kind: "ignored",
    });
    expect((await channels.telegramFor({ responseId }))?.chatId).toBe("42");
  });

  it("deletes the chat when the bot was blocked before it could answer Start", async () => {
    const { request, responseId } = await responder("Ben");
    await requestTelegram(deps, request);
    const id = (await channels.telegramFor({ responseId }))?.id ?? "";
    outbox.result = "gone";
    await startTelegramChat(deps, { startToken: `start-${id}`, chatId: "42" });
    expect(await channels.telegramFor({ responseId })).toBeUndefined();
    expect(await telegramSetting(deps, request)).toEqual({ kind: "setting", state: "off" });
  });

  it("is turned off from its link, which never confirms, and from the page", async () => {
    const { request, responseId } = await responder("Ben");
    await requestTelegram(deps, request);
    const id = (await channels.telegramFor({ responseId }))?.id ?? "";
    expect(await openChannelLink(deps, links.tokenFor(id))).toMatchObject({
      kind: "turnOff",
      channel: "telegram",
    });
    expect(await useChannelLink(deps, { token: links.tokenFor(id), action: "confirm" })).toEqual({
      kind: "not_found",
    });
    await startTelegramChat(deps, { startToken: `start-${id}`, chatId: "42" });
    expect(await useChannelLink(deps, { token: links.tokenFor(id), action: "off" })).toEqual({
      kind: "off",
      channel: "telegram",
    });
    await requestTelegram(deps, request);
    expect(await turnOffTelegram(deps, request)).toEqual({ kind: "off" });
    expect(await channels.telegramFor({ responseId })).toBeUndefined();
  });

  it("sends the plan's deletion notice to the chat, after the channel went with the plan", async () => {
    const { request, responseId } = await responder("Ben");
    await requestTelegram(deps, request);
    const id = (await channels.telegramFor({ responseId }))?.id ?? "";
    await startTelegramChat(deps, { startToken: `start-${id}`, chatId: "42" });
    jobs.jobs.clear();
    const send = await deletionNotices(deps, (await repos.plans.findById(planId))!);
    await send();
    expect(queued()).toEqual(["deleted 42"]);
    const notifier = new FakeNotifier();
    const [job] = [...jobs.jobs.values()];
    expect(await notificationHandler({ notifier })(job?.payload)).toBe("done");
    expect(notifier.sent[0]?.to).toEqual({ telegram: { chatId: "42" } });
  });
});

describe("without the bot (decision D34)", () => {
  it("offers nothing until Telegram told the bot's name, and keeps stored chats removable", async () => {
    const { request, responseId } = await responder("Ben");
    botName = undefined;
    expect(await telegramSetting(deps, request)).toEqual({ kind: "unavailable" });
    expect(await requestTelegram(deps, request)).toEqual({ kind: "unavailable" });
    botName = "isar_runs_bot";
    await requestTelegram(deps, request);
    // Still waiting while Telegram cannot be reached: no deep link, but no "on" either.
    botName = undefined;
    expect(await telegramSetting(deps, request)).toEqual({
      kind: "setting",
      state: "pending",
      start: undefined,
    });
    botName = "isar_runs_bot";
    const id = (await channels.telegramFor({ responseId }))?.id ?? "";
    await startTelegramChat(deps, { startToken: `start-${id}`, chatId: "42" });
    deps = { ...deps, notify: deps.notify && { ...deps.notify, telegram: undefined } };
    expect(await telegramSetting(deps, request)).toEqual({
      kind: "setting",
      state: "on",
      sending: false,
    });
    jobs.jobs.clear();
    await notifyResponders(deps, (await repos.plans.findById(planId))!, "changed");
    expect(queued()).toEqual([]);
    await turnOffTelegram(deps, request);
    expect(await telegramSetting(deps, request)).toEqual({ kind: "unavailable" });
  });
});
