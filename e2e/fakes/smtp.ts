// A fake mail server for end-to-end tests (decision D31): just enough SMTP for Nodemailer without
// TLS or login, keeping each message in memory. The tests read them over HTTP (/mail?to=…), with
// quoted-printable soft line breaks and escapes undone so links can be found.
import { createServer as createTcpServer } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";

interface Mail {
  to: string[];
  /** The message as sent, quoted-printable decoded. */
  text: string;
}

const mails: Mail[] = [];

const decodeQuotedPrintable = (raw: string) =>
  Buffer.from(
    raw
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-F]{2})/g, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      ),
    "latin1",
  ).toString("utf8");

export function startSmtp(port: number) {
  createTcpServer((socket) => {
    let buffer = "";
    let inData = false;
    let to: string[] = [];
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply("220 fakes ESMTP");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end === -1) return;
          const body = buffer.slice(0, end).replace(/^\.\./gm, ".");
          buffer = buffer.slice(end + 5);
          inData = false;
          mails.push({ to, text: decodeQuotedPrintable(body) });
          to = [];
          reply("250 OK queued");
          continue;
        }
        const newline = buffer.indexOf("\r\n");
        if (newline === -1) return;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        const command = line.slice(0, 4).toUpperCase();
        if (command === "EHLO" || command === "HELO") reply("250 fakes");
        else if (command === "MAIL") reply("250 OK");
        else if (command === "RCPT") {
          to.push(/<([^>]*)>/.exec(line)?.[1] ?? "");
          reply("250 OK");
        } else if (command === "DATA") {
          inData = true;
          reply("354 End data with <CR><LF>.<CR><LF>");
        } else if (command === "QUIT") {
          reply("221 Bye");
          socket.end();
        } else if (command === "RSET" || command === "NOOP") reply("250 OK");
        else reply("502 Not implemented");
      }
    });
    socket.on("error", () => socket.destroy());
  }).listen(port);
}

/** GET /mail?to=<address>: the messages sent to it, oldest first. */
export function handleMail(_request: IncomingMessage, response: ServerResponse, url: URL): boolean {
  if (url.pathname !== "/mail") return false;
  const to = url.searchParams.get("to") ?? "";
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(mails.filter((mail) => mail.to.includes(to))));
  return true;
}
