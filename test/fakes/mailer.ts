import type { Mailer, MailMessage } from "../../src/adapters/out/email/mailer.ts";
import type { SendResult } from "../../src/application/ports.ts";

/** Keeps what it was asked to send and answers with a configurable result. */
export class FakeMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  result: SendResult = "sent";

  send(message: MailMessage) {
    this.sent.push(message);
    return Promise.resolve(this.result);
  }
}
