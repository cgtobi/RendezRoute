// The Telegram Bot API (decision D34): the bot's name, new messages by long polling (decision D21:
// no webhook, so instances behind a home router work), and sending a message with buttons. The
// API is trusted configuration (TELEGRAM_API_URL, Telegram's own by default). The bot token is
// part of every request path and is never logged.
import type { SendResult } from "../../../application/ports.ts";
import type { TrustedFetch } from "../http/trusted-fetch.ts";

/** A button under a message that opens a URL. */
export interface TelegramButton {
  text: string;
  url: string;
}

export interface TelegramMessage {
  chatId: string;
  text: string;
  /** One button per row. */
  buttons: TelegramButton[];
}

/** A private message to the bot: who sent it, and its text. */
export interface TelegramUpdate {
  updateId: number;
  chatId: string;
  /** Only private chats: Start in a group is ignored. */
  private: boolean;
  text: string;
}

/** Telegram's answer, or why there is none: its status code, or "unreachable". */
export type BotAnswer<T> = { ok: true; value: T } | { ok: false; reason: string };

export interface TelegramClient {
  /** The bot's username, for t.me links. */
  botName(signal: AbortSignal): Promise<BotAnswer<string>>;
  /** Messages after `offset`, waiting up to `waitSeconds` for one. */
  updates(
    offset: number,
    waitSeconds: number,
    signal: AbortSignal,
  ): Promise<BotAnswer<TelegramUpdate[]>>;
  send(message: TelegramMessage): Promise<SendResult>;
}

interface ApiAnswer<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
}

export function createTelegramClient({
  apiUrl,
  token,
  fetch,
}: {
  apiUrl: URL;
  token: string;
  fetch: TrustedFetch;
}): TelegramClient {
  // "./" first: "bot123:ABC…" would otherwise read as a URL scheme and drop the API's address.
  const method = (name: string) =>
    new URL(`./bot${token}/${name}`, apiUrl.href.endsWith("/") ? apiUrl : `${apiUrl.href}/`).href;
  const call = async <T>(
    name: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<{ status: number; answer: ApiAnswer<T> | undefined }> => {
    const response = await fetch(method(name), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const answer = (await response.json().catch(() => undefined)) as ApiAnswer<T> | undefined;
    return { status: response.status, answer };
  };
  /** The result of a call that reads one; a refusal is named by its status, never its text. */
  const result = async <T>(
    name: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<BotAnswer<T>> => {
    try {
      const { status, answer } = await call<T>(name, body, signal);
      return answer?.ok === true && answer.result !== undefined
        ? { ok: true, value: answer.result }
        : { ok: false, reason: `status ${status}` };
    } catch {
      return { ok: false, reason: "unreachable" };
    }
  };

  return {
    async botName(signal) {
      const answer = await result<{ username?: string }>("getMe", {}, signal);
      if (!answer.ok) return answer;
      const name = answer.value.username;
      return name === undefined ? { ok: false, reason: "no username" } : { ok: true, value: name };
    },

    async updates(offset, waitSeconds, signal) {
      const answer = await result<RawUpdate[]>(
        "getUpdates",
        { offset, timeout: waitSeconds, allowed_updates: ["message"] },
        signal,
      );
      if (!answer.ok) return answer;
      return {
        ok: true,
        value: answer.value.map((update) => ({
          updateId: update.update_id,
          chatId: String(update.message?.chat?.id ?? ""),
          private: update.message?.chat?.type === "private",
          text: update.message?.text ?? "",
        })),
      };
    },

    async send({ chatId, text, buttons }) {
      let status: number;
      try {
        ({ status } = await call("sendMessage", {
          chat_id: chatId,
          text,
          link_preview_options: { is_disabled: true },
          reply_markup: { inline_keyboard: buttons.map((button) => [button]) },
        }));
      } catch {
        return "retry";
      }
      if (status >= 200 && status < 300) return "sent";
      if (status === 429 || status >= 500) return "retry";
      // 403: the person blocked the bot or deleted the chat; it will not come back (D34).
      return status === 403 ? "gone" : "failed";
    },
  };
}

interface RawUpdate {
  update_id: number;
  message?: { text?: string; chat?: { id?: number; type?: string } };
}
