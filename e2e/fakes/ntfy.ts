// A fake ntfy server for end-to-end tests (decision D33): keeps every JSON message posted to
// /ntfy; the tests read them back from /ntfy-messages?topic=… .
import type { IncomingMessage, ServerResponse } from "node:http";

const messages: Record<string, unknown>[] = [];

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function handleNtfy(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname === "/ntfy" && request.method === "POST") {
    messages.push(JSON.parse(await body(request)) as Record<string, unknown>);
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
    return true;
  }
  if (url.pathname === "/ntfy-messages") {
    const topic = url.searchParams.get("topic") ?? "";
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(messages.filter((message) => message.topic === topic)));
    return true;
  }
  return false;
}
