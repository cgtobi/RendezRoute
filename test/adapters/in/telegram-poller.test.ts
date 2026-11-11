// Reading the bot's messages (decisions D21, D34): long polling, the offset kept between restarts,
// and staying up while Telegram or the database fails.
import { describe, expect, it } from "vite-plus/test";
import { startTelegramPoller } from "../../../src/adapters/in/telegram-poller.ts";
import { createLogger } from "../../../src/adapters/logging.ts";
import { FakeTelegramClient } from "../../fakes/telegram.ts";

function recordingLogger() {
  const lines: string[] = [];
  const logger = createLogger({ write: (line) => lines.push(line) });
  const events = () =>
    lines.map((line) => {
      const { event, reason } = JSON.parse(line) as { event: string; reason?: string };
      return reason === undefined ? event : `${event} ${reason}`;
    });
  return { logger, events, lines };
}

const noOffset = { read: () => Promise.resolve(0), write: () => Promise.resolve() };

describe("the poller (decisions D21, D34)", () => {
  it("hands each private /start with a code on, remembers where it stopped, and skips the rest", async () => {
    const client = new FakeTelegramClient();
    client.queued.push(
      { updateId: 10, chatId: "42", private: true, text: "/start code_1" },
      { updateId: 11, chatId: "43", private: true, text: "/start" },
      { updateId: 12, chatId: "-5", private: false, text: "/start code_2" },
      { updateId: 13, chatId: "44", private: true, text: "hello" },
      { updateId: 14, chatId: "45", private: true, text: "/start@isar_runs_bot code_3" },
    );
    const started: { startToken: string; chatId: string }[] = [];
    let stored = 0;
    const poller = startTelegramPoller({
      client,
      offset: {
        read: () => Promise.resolve(0),
        write: (value) => ((stored = value), Promise.resolve()),
      },
      onStart: (start) => (started.push(start), Promise.resolve()),
      logger: recordingLogger().logger,
      pauseMs: 5,
    });
    await expect.poll(() => stored).toBe(15);
    expect(poller.botName()).toBe("rendezroute_test_bot");
    await poller.stop();
    expect(started).toEqual([
      { startToken: "code_1", chatId: "42" },
      { startToken: "code_3", chatId: "45" },
    ]);
  });

  it("waits for the bot's name before reading, and stops at once while waiting", async () => {
    const client = new FakeTelegramClient();
    client.name = undefined;
    const { logger, events } = recordingLogger();
    const poller = startTelegramPoller({
      client,
      offset: noOffset,
      onStart: () => Promise.resolve(),
      logger,
      pauseMs: 60_000,
    });
    // Logged just before the pause begins.
    await expect.poll(() => events()).toEqual(["telegram_unavailable no username"]);
    expect(poller.botName()).toBeUndefined();
    const stoppedAt = Date.now();
    await poller.stop();
    expect(Date.now() - stoppedAt).toBeLessThan(1_000);
  });

  it("logs a refusal once, without the token, and once more when Telegram works again", async () => {
    const client = new FakeTelegramClient();
    client.failure = "status 401";
    const { logger, events, lines } = recordingLogger();
    const poller = startTelegramPoller({
      client,
      offset: noOffset,
      onStart: () => Promise.resolve(),
      logger,
      pauseMs: 1,
    });
    await expect.poll(() => events()).toEqual(["telegram_unavailable status 401"]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events()).toEqual(["telegram_unavailable status 401"]);
    client.failure = undefined;
    await expect.poll(() => events().at(-1)).toBe("telegram_available");
    expect(poller.botName()).toBe("rendezroute_test_bot");
    await poller.stop();
    expect(lines.join("\n")).not.toContain("AAH");
  });

  it("keeps reading when the offset cannot be kept, instead of taking the server down", async () => {
    const client = new FakeTelegramClient();
    client.queued.push({ updateId: 3, chatId: "42", private: true, text: "/start code_1" });
    const { logger, events } = recordingLogger();
    let reads = 0;
    const started: string[] = [];
    const poller = startTelegramPoller({
      client,
      offset: {
        read: () => (++reads === 1 ? Promise.reject(new Error("SQLITE_BUSY")) : Promise.resolve(0)),
        write: () => Promise.reject(new Error("SQLITE_BUSY")),
      },
      onStart: (start) => (started.push(start.startToken), Promise.resolve()),
      logger,
      pauseMs: 1,
    });
    await expect.poll(() => started).toEqual(["code_1"]);
    await poller.stop();
    expect(events()).toContain("telegram_poll_failed");
  });
});
