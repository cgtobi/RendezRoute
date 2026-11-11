// Reading the bot's messages (decision D34): a long-polling loop (decision D21), not a webhook, so
// instances behind a home router work. Every "/start <code>" from a private chat is handed to the
// use case that links the chat; everything else is skipped. The last message read is remembered,
// so a restart neither repeats nor misses one. The bot's name, needed for the page's deep link,
// is asked for until Telegram answers. While Telegram refuses or cannot be reached, the loop
// pauses between attempts and logs it once, and again once it works.
import { setTimeout as sleep } from "node:timers/promises";
import type { Logger } from "../logging.ts";
import type { TelegramClient } from "../out/telegram/client.ts";

/** How long one request waits for a message; Telegram allows up to 50 seconds. */
export const TELEGRAM_WAIT_SECONDS = 25;
/** After a failed or empty quick answer, before asking again. */
const PAUSE_MS = 5_000;
const START = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{1,64})$/;

export interface TelegramPoller {
  /** The bot's username, once Telegram told it. */
  botName(): string | undefined;
  stop(): Promise<void>;
}

export function startTelegramPoller({
  client,
  offset,
  onStart,
  logger,
  pauseMs = PAUSE_MS,
}: {
  client: TelegramClient;
  /** Where the next update's number is kept between restarts. */
  offset: { read(): Promise<number>; write(value: number): Promise<void> };
  onStart: (start: { startToken: string; chatId: string }) => Promise<unknown>;
  logger: Logger;
  pauseMs?: number;
}): TelegramPoller {
  const controller = new AbortController();
  const signal = controller.signal;
  let name: string | undefined;
  // Ends early when stopped, also when stopped already.
  const pause = () => sleep(pauseMs, undefined, { signal }).catch(() => undefined);

  let failing = false;
  const failed = async (reason: string) => {
    if (signal.aborted) return;
    if (!failing) logger.warn("telegram_unavailable", { reason });
    failing = true;
    await pause();
  };
  const working = () => {
    if (failing) logger.info("telegram_available");
    failing = false;
  };

  const handle = async (text: string, chatId: string) => {
    const start = START.exec(text.trim());
    if (start?.[1] === undefined) return;
    try {
      await onStart({ startToken: start[1], chatId });
    } catch (error) {
      // Error class only: messages may contain user input (decision I18).
      logger.error("telegram_start_failed", {
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  };

  const loop = (async () => {
    let next: number | undefined;
    while (!signal.aborted) {
      try {
        next ??= await offset.read();
        if (name === undefined) {
          const answer = await client.botName(signal);
          if (!answer.ok) {
            await failed(answer.reason);
            continue;
          }
          name = answer.value;
        }
        const startedAt = Date.now();
        const answer = await client.updates(next, TELEGRAM_WAIT_SECONDS, signal);
        if (!answer.ok) {
          await failed(answer.reason);
          continue;
        }
        working();
        for (const update of answer.value) {
          if (update.private) await handle(update.text, update.chatId);
          next = Math.max(next, update.updateId + 1);
        }
        if (answer.value.length > 0) await offset.write(next);
        // An empty answer at once means the server does not wait: do not hammer it.
        else if (Date.now() - startedAt < 1_000) await pause();
      } catch (error) {
        // Reading or keeping the offset failed (the database): try again after a pause.
        logger.error("telegram_poll_failed", {
          error: error instanceof Error ? error.name : "unknown",
        });
        await pause();
      }
    }
  })();

  return {
    botName: () => name,
    async stop() {
      controller.abort();
      await loop;
    },
  };
}
