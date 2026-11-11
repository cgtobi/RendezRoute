// Telegram through the pages (spec 7 Optional notification channels, decision D34): connected in
// the "More ways to be notified" fold, confirmed by pressing Start in the bot, turned off from
// every message.
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { escaped } from "../../support/html.ts";
import { createPlanViaUi, respondViaUi } from "../../support/plans.ts";

const en = translator("en");
const BOT = { TELEGRAM_BOT_TOKEN: "123456789:AAH-abcdefghijklmnopqrstuvwxyz012345" };

async function setup(env: Record<string, string> = BOT) {
  const test = await createTestApp({ env });
  const host = new TestClient(test.app);
  const { planId } = await createPlanViaUi(host);
  const ben = new TestClient(test.app);
  await respondViaUi(ben, planId, "Ben", "joined");
  return { ...test, host, ben, planId };
}

async function post(client: TestClient, page: string, action: string) {
  const hidden = await client.hiddenFields(page);
  return client.postForm(action, { _csrf: hidden._csrf ?? "" });
}

/** The one-time code in the page's deep link into the bot. */
const startCode = (html: string) =>
  /https:\/\/t\.me\/rendezroute_test_bot\?start=([A-Za-z0-9_-]+)/.exec(html)?.[1];

describe("Telegram on the manage and host pages (decision D34)", () => {
  it("is offered only with a bot", async () => {
    const without = await setup({});
    expect(await (await without.ben.get(`/p/${without.planId}/me`)).text()).not.toContain(
      "/me/telegram",
    );
    const { ben, host, planId } = await setup();
    expect(await (await ben.get(`/p/${planId}/me`)).text()).toContain(escaped(en("telegram.hint")));
    expect(await (await host.get(`/p/${planId}/host`)).text()).toContain(
      `action="/p/${planId}/host/telegram"`,
    );
  });

  it("shows the deep link, sends nothing before Start, and is on once Start was pressed", async () => {
    const { ben, host, planId, telegramClient, pressStart, runJobs } = await setup();
    const connected = await post(ben, `/p/${planId}/me`, `/p/${planId}/me/telegram`);
    expect(connected.headers.get("location")).toBe(`/p/${planId}/me#telegram`);
    const page = await (await ben.get(`/p/${planId}/me`)).text();
    expect(page).toContain('<details class="more-channels" open="">');
    expect(page).not.toContain(escaped(en("telegram.hostShared")));
    expect(page).toContain(escaped(en("telegram.pending")));
    const code = startCode(page);
    expect(code).toBeDefined();

    await host.postForm(`/p/${planId}/host/cancel`, await host.hiddenFields(`/p/${planId}/host`));
    await runJobs();
    expect(telegramClient.sent).toEqual([]);

    expect(await pressStart(code ?? "", "42")).toEqual({ kind: "confirmed" });
    expect(telegramClient.sent.map((message) => message.chatId)).toEqual(["42"]);
    expect(await (await ben.get(`/p/${planId}/me`)).text()).toContain(
      escaped(en("telegram.onPage")),
    );
  });

  it("says a chat is still waiting, without a link, while Telegram cannot be reached", async () => {
    const { ben, planId, telegramClient } = await setup();
    await post(ben, `/p/${planId}/me`, `/p/${planId}/me/telegram`);
    telegramClient.name = undefined;
    const page = await (await ben.get(`/p/${planId}/me`)).text();
    expect(page).toContain(escaped(en("telegram.unreachable")));
    expect(page).not.toContain("https://t.me/");
    expect(page).toContain(`action="/p/${planId}/me/telegram/off"`);
  });

  it("delivers notifications with a button to turn Telegram off, which works", async () => {
    const { app, ben, host, planId, telegramClient, pressStart, runJobs } = await setup();
    await post(ben, `/p/${planId}/me`, `/p/${planId}/me/telegram`);
    await pressStart(startCode(await (await ben.get(`/p/${planId}/me`)).text()) ?? "", "42");
    await host.postForm(`/p/${planId}/host/cancel`, await host.hiddenFields(`/p/${planId}/host`));
    await runJobs();
    const message = telegramClient.sent.at(-1);
    expect(message?.text).toContain(en("notify.cancelled"));
    const offUrl = message?.buttons.at(-1)?.url ?? "";
    expect(offUrl).toMatch(/^https:\/\/runs\.example\.org\/e\//);

    const phone = new TestClient(app);
    const page = await (await phone.get(new URL(offUrl).pathname)).text();
    expect(page).toContain(escaped(en("telegramLink.offHeading")));
    const off = await phone.postForm("/e", { ...hiddenFields(page), action: "off" });
    expect(await off.text()).toContain(escaped(en("telegramLink.turnedOff")));
    expect(await (await ben.get(`/p/${planId}/me`)).text()).not.toContain(
      escaped(en("telegram.onPage")),
    );
  });

  it("ends when the person blocked the bot: Telegram refuses and the chat is deleted", async () => {
    const { ben, host, planId, telegramClient, pressStart, runJobs } = await setup();
    await post(ben, `/p/${planId}/me`, `/p/${planId}/me/telegram`);
    await pressStart(startCode(await (await ben.get(`/p/${planId}/me`)).text()) ?? "", "42");
    telegramClient.result = "gone";
    await host.postForm(`/p/${planId}/host/cancel`, await host.hiddenFields(`/p/${planId}/host`));
    await runJobs();
    const page = await (await ben.get(`/p/${planId}/me`)).text();
    expect(page).not.toContain(escaped(en("telegram.onPage")));
    expect(page).toContain(`action="/p/${planId}/me/telegram"`);
  });

  it("is turned off from the page", async () => {
    const { host, planId } = await setup();
    await post(host, `/p/${planId}/host`, `/p/${planId}/host/telegram`);
    const page = await (await host.get(`/p/${planId}/host`)).text();
    expect(page).toContain(escaped(en("telegram.pending")));
    // Every co-host sees the link: whoever presses Start first gets the plan's notifications.
    expect(page).toContain(escaped(en("telegram.hostShared")));
    await post(host, `/p/${planId}/host`, `/p/${planId}/host/telegram/off`);
    expect(await (await host.get(`/p/${planId}/host`)).text()).not.toContain(
      escaped(en("telegram.pending")),
    );
  });
});

describe("exports (spec 3.7: everything attached)", () => {
  it("include the linked chat, and none while it waits for Start", async () => {
    const { ben, host, planId, pressStart } = await setup();
    const exported = async (client: TestClient, path: string) => {
      const files = unzipSync(new Uint8Array(await (await client.get(path)).arrayBuffer()));
      return JSON.parse(strFromU8(files["data.json"] ?? new Uint8Array())) as {
        version: number;
        plans: { telegramChat: unknown }[];
      };
    };
    await post(ben, `/p/${planId}/me`, `/p/${planId}/me/telegram`);
    await post(host, `/p/${planId}/host`, `/p/${planId}/host/telegram`);
    expect((await exported(ben, `/p/${planId}/me/export.zip`)).plans[0]?.telegramChat).toBeNull();
    await pressStart(startCode(await (await ben.get(`/p/${planId}/me`)).text()) ?? "", "42");
    await pressStart(startCode(await (await host.get(`/p/${planId}/host`)).text()) ?? "", "7");
    const response = await exported(ben, `/p/${planId}/me/export.zip`);
    expect(response.version).toBe(7);
    expect(response.plans[0]?.telegramChat).toBe("42");
    expect((await exported(host, `/p/${planId}/host/export.zip`)).plans[0]?.telegramChat).toBe("7");
  });
});

describe("privacy notice", () => {
  it("says what goes through Telegram when a bot is configured", async () => {
    const text = (html: string) => html.replaceAll("&#39;", "'");
    const withBot = await createTestApp({ env: BOT });
    expect(text(await (await withBot.app.request("/privacy")).text())).toContain(
      en("privacy.telegram"),
    );
    const without = await createTestApp();
    expect(text(await (await without.app.request("/privacy")).text())).not.toContain("Telegram’s");
  });
});
