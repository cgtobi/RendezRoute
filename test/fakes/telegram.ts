import type {
  BotAnswer,
  TelegramClient,
  TelegramMessage,
  TelegramUpdate,
} from "../../src/adapters/out/telegram/client.ts";
import type { SendResult } from "../../src/application/ports.ts";

/** A bot that keeps what it was asked to send, and hands out the updates a test queues. */
export class FakeTelegramClient implements TelegramClient {
  readonly sent: TelegramMessage[] = [];
  readonly queued: TelegramUpdate[] = [];
  name: string | undefined = "rendezroute_test_bot";
  result: SendResult = "sent";

  /** Set to make Telegram refuse: every call then fails with it. */
  failure: string | undefined;

  botName(): Promise<BotAnswer<string>> {
    if (this.failure !== undefined) return Promise.resolve({ ok: false, reason: this.failure });
    return Promise.resolve(
      this.name === undefined
        ? { ok: false, reason: "no username" }
        : { ok: true, value: this.name },
    );
  }

  updates(offset: number): Promise<BotAnswer<TelegramUpdate[]>> {
    if (this.failure !== undefined) return Promise.resolve({ ok: false, reason: this.failure });
    const due = this.queued.filter((update) => update.updateId >= offset);
    this.queued.length = 0;
    return Promise.resolve({ ok: true, value: due });
  }

  send(message: TelegramMessage) {
    this.sent.push(message);
    return Promise.resolve(this.result);
  }
}
