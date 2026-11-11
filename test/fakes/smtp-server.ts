// A local SMTP server for tests (decision D31): keeps every message it accepts, and refuses
// recipients or messages with the codes a test sets.
import type { AddressInfo } from "node:net";
import { SMTPServer, type SMTPServerAddress } from "smtp-server";

export interface ReceivedMail {
  from: string;
  to: string[];
  /** The raw message: headers and body. */
  raw: string;
}

export class FakeSmtpServer {
  readonly received: ReceivedMail[] = [];
  /** SMTP reply code for RCPT TO, e.g. 550 (no such user) or 451 (try later). */
  refuseRecipient: number | undefined;
  readonly logins: { username: string; password: string }[] = [];
  #server: SMTPServer;
  port = 0;

  constructor({ auth = false }: { auth?: boolean } = {}) {
    this.#server = new SMTPServer({
      disabledCommands: auth ? ["STARTTLS"] : ["STARTTLS", "AUTH"],
      authOptional: !auth,
      allowInsecureAuth: true,
      logger: false,
      onAuth: (login, _session, callback) => {
        this.logins.push({ username: login.username ?? "", password: login.password ?? "" });
        callback(null, { user: login.username });
      },
      onRcptTo: (_address: SMTPServerAddress, _session, callback) => {
        if (this.refuseRecipient === undefined) return callback();
        const error = new Error("refused") as Error & { responseCode: number };
        error.responseCode = this.refuseRecipient;
        return callback(error);
      },
      onData: (stream, session, callback) => {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          this.received.push({
            from: session.envelope.mailFrom === false ? "" : session.envelope.mailFrom.address,
            to: session.envelope.rcptTo.map((rcpt) => rcpt.address),
            raw: Buffer.concat(chunks).toString("utf8"),
          });
          callback();
        });
      },
    });
  }

  async start(): Promise<this> {
    await new Promise<void>((resolve) => this.#server.listen(0, "127.0.0.1", resolve));
    this.port = (this.#server.server.address() as AddressInfo).port;
    return this;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.#server.close(() => resolve()));
  }
}
