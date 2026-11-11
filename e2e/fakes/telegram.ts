// A fake Telegram Bot API for end-to-end tests (decision D34): getMe, getUpdates (long polling,
// answered when an update is queued or after two seconds) and sendMessage, under /telegram/bot<t>/.
// The tests press Start through /telegram-test/start and read the bot's messages from
// /telegram-test/messages?chat=… .
import type { IncomingMessage, ServerResponse } from "node:http";

interface Update {
  update_id: number;
  message: { text: string; chat: { id: number; type: "private" } };
}

const updates: Update[] = [];
const sent: { chat_id: string; text: string; reply_markup?: unknown }[] = [];
// Like Telegram's, update numbers only grow, also across restarts of the fakes: the app keeps the
// last one it read, in a volume kept with E2E_KEEP=true.
let nextId = Math.floor(Date.now() / 1000);

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text === "" ? {} : (JSON.parse(text) as Record<string, unknown>);
}

const json = (response: ServerResponse, value: unknown) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
};

export async function handleTelegram(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  const api = /^\/telegram\/bot[^/]+\/(\w+)$/.exec(url.pathname);
  if (api !== null) {
    const input = await body(request);
    switch (api[1]) {
      case "getMe":
        json(response, { ok: true, result: { username: "rendezroute_e2e_bot" } });
        return true;
      case "getUpdates": {
        const offset = Number(input.offset ?? 0);
        const until = Date.now() + 2_000;
        while (Date.now() < until && !updates.some((update) => update.update_id >= offset)) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        json(response, {
          ok: true,
          result: updates.filter((update) => update.update_id >= offset),
        });
        return true;
      }
      case "sendMessage":
        sent.push({
          chat_id: String(input.chat_id),
          text: String(input.text),
          reply_markup: input.reply_markup,
        });
        json(response, { ok: true, result: {} });
        return true;
    }
    response.writeHead(404).end();
    return true;
  }
  if (url.pathname === "/telegram-test/start" && request.method === "POST") {
    const input = await body(request);
    updates.push({
      update_id: nextId++,
      message: { text: String(input.text), chat: { id: Number(input.chatId), type: "private" } },
    });
    json(response, { ok: true });
    return true;
  }
  if (url.pathname === "/telegram-test/messages") {
    json(
      response,
      sent.filter((message) => message.chat_id === url.searchParams.get("chat")),
    );
    return true;
  }
  return false;
}
