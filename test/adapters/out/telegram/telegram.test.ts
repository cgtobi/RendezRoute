// Telegram (decision D34): the Start code, the Bot API client and the messages.
import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { createChannelLinks } from "../../../../src/adapters/out/crypto/channel-links.ts";
import type { TrustedFetch } from "../../../../src/adapters/out/http/trusted-fetch.ts";
import { createTelegramClient } from "../../../../src/adapters/out/telegram/client.ts";
import { createTelegram } from "../../../../src/adapters/out/telegram/notifier.ts";
import type { Notification } from "../../../../src/domain/notification.ts";
import { FakeChannelLinks } from "../../../fakes/channel-links.ts";
import { FakeTelegramClient } from "../../../fakes/telegram.ts";

const TOKEN = "123456789:AAH-abcdefghijklmnopqrstuvwxyz012345";
const signal = new AbortController().signal;
const instance = { baseUrl: new URL("https://runs.example.org"), instanceName: "Isar Runs" };

describe("the Start code (decision D34)", () => {
  it("fits Telegram's 64 characters, names its channel, and cannot be made up", () => {
    const links = createChannelLinks(randomBytes(32));
    const id = randomUUID();
    const token = links.startTokenFor(id);
    expect(token).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(links.channelOfStart(token)).toBe(id);
    expect(createChannelLinks(randomBytes(32)).channelOfStart(token)).toBeUndefined();
    expect(
      links.channelOfStart(links.startTokenFor(randomUUID()).slice(0, 32) + token.slice(32)),
    ).toBeUndefined();
    expect(links.channelOfStart(`${token}x`)).toBeUndefined();
    // Not the same as the channel's link: one cannot stand in for the other.
    expect(links.channelOf(token)).toBeUndefined();
  });
});

describe("Bot API client", () => {
  function api(answers: Record<string, { status: number; body: unknown } | Error>) {
    const calls: { url: string; body: unknown }[] = [];
    const fetch: TrustedFetch = (url, init) => {
      calls.push({ url, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
      const answer = answers[url.split("/").pop() ?? ""];
      if (answer === undefined || answer instanceof Error)
        return Promise.reject(answer ?? new Error("no"));
      return Promise.resolve(Response.json(answer.body, { status: answer.status }));
    };
    return {
      calls,
      client: createTelegramClient({
        apiUrl: new URL("https://api.telegram.org"),
        token: TOKEN,
        fetch,
      }),
    };
  }

  it("asks for the bot's name, and for private messages after an offset", async () => {
    const { calls, client } = api({
      getMe: { status: 200, body: { ok: true, result: { username: "isar_runs_bot" } } },
      getUpdates: {
        status: 200,
        body: {
          ok: true,
          result: [
            { update_id: 7, message: { text: "/start abc", chat: { id: 42, type: "private" } } },
            { update_id: 8, message: { text: "/start abc", chat: { id: -5, type: "group" } } },
          ],
        },
      },
    });
    expect(await client.botName(signal)).toEqual({ ok: true, value: "isar_runs_bot" });
    expect(calls[0]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/getMe`);
    expect(await client.updates(7, 25, signal)).toEqual({
      ok: true,
      value: [
        { updateId: 7, chatId: "42", private: true, text: "/start abc" },
        { updateId: 8, chatId: "-5", private: false, text: "/start abc" },
      ],
    });
    expect(calls[1]?.body).toEqual({ offset: 7, timeout: 25, allowed_updates: ["message"] });
  });

  it("sends a message with one button per row, and maps Telegram's answers", async () => {
    const answer = (status: number) =>
      api({ sendMessage: { status, body: { ok: status === 200 } } });
    const ok = answer(200);
    const message = { chatId: "42", text: "Hi", buttons: [{ text: "Open", url: "https://x" }] };
    expect(await ok.client.send(message)).toBe("sent");
    expect(ok.calls[0]?.body).toEqual({
      chat_id: "42",
      text: "Hi",
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: "Open", url: "https://x" }]] },
    });
    // Blocked by the person: gone for good, so the channel is deleted.
    expect(await answer(403).client.send(message)).toBe("gone");
    expect(await answer(429).client.send(message)).toBe("retry");
    expect(await answer(502).client.send(message)).toBe("retry");
    expect(await answer(400).client.send(message)).toBe("failed");
    expect(await api({ sendMessage: new Error("offline") }).client.send(message)).toBe("retry");
  });

  it("says why there is no answer: Telegram's status, or that it cannot be reached", async () => {
    expect(await api({}).client.botName(signal)).toEqual({ ok: false, reason: "unreachable" });
    // A wrong token, or a webhook still set: the operator needs to know (logged by the poller).
    const refused = api({
      getMe: { status: 401, body: { ok: false, error_code: 401 } },
      getUpdates: { status: 409, body: { ok: false, error_code: 409 } },
    });
    expect(await refused.client.botName(signal)).toEqual({ ok: false, reason: "status 401" });
    expect(await refused.client.updates(0, 25, signal)).toEqual({
      ok: false,
      reason: "status 409",
    });
  });
});

describe("Telegram messages", () => {
  const client = new FakeTelegramClient();
  const telegram = createTelegram({
    client,
    links: new FakeChannelLinks(),
    timeZone: "Europe/Berlin",
    ...instance,
  });
  const notification: Notification = {
    kind: "cancelled",
    planTitle: "Hill repeats",
    facts: { startsAt: "2026-06-07T06:30:00.000Z", timeZone: "Europe/Berlin", area: "Flaucher" },
    planPath: "/p/abc",
    language: "en",
  };

  it("carry title, sentence, time and place, and buttons to the plan and to turn Telegram off", async () => {
    await telegram.delivery.send({ chatId: "42", channelId: "c1" }, notification);
    expect(client.sent.at(-1)).toEqual({
      chatId: "42",
      text: "Hill repeats\nThe plan was cancelled.\nSunday, 7 June 2026, 08:30 (Europe/Berlin time)\nFlaucher",
      buttons: [
        { text: "Open the plan", url: "https://runs.example.org/p/abc" },
        { text: "Turn off Telegram", url: "https://runs.example.org/e/link-c1" },
      ],
    });
  });

  it("have nothing to turn off once the channel is gone with its plan", async () => {
    await telegram.delivery.send(
      { chatId: "42", channelId: undefined },
      { ...notification, kind: "deleted", planPath: undefined },
    );
    expect(client.sent.at(-1)?.buttons).toEqual([]);
  });

  it("answer Start in the owner's language, and warn before an unused account is deleted", async () => {
    const to = { kind: "telegram" as const, channelId: "c2", chatId: "42", language: "de" };
    await telegram.outbox.confirmation(to, { kind: "plan", planTitle: "Hill repeats" });
    expect(client.sent.at(-1)?.text).toContain("„Hill repeats“ sind eingeschaltet");
    expect(client.sent.at(-1)?.buttons).toEqual([
      { text: "Telegram abschalten", url: "https://runs.example.org/e/link-c2" },
    ]);
    await telegram.outbox.accountExpiry(
      { ...to, language: "en" },
      new Date("2027-06-07T08:00:00Z"),
    );
    expect(client.sent.at(-1)?.text).toContain("will be deleted on 7 June 2027");
  });
});
