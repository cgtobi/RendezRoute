import type {
  EmailOutbox,
  EmailRecipient,
  ChannelSubject,
  SendResult,
} from "../../src/application/ports.ts";

/** Keeps each email it was asked to send, as a short line, and answers with a set result. */
export class FakeOutbox implements EmailOutbox {
  readonly sent: string[] = [];
  /** The links of "Email me my links", by address. */
  readonly links = new Map<string, string>();
  result: SendResult = "sent";

  confirmation(to: EmailRecipient, about: ChannelSubject) {
    const what = about.kind === "plan" ? about.planTitle : "account";
    this.sent.push(`confirm ${to.address} ${what} ${to.language}`);
    return Promise.resolve(this.result);
  }

  reportAlert() {
    this.sent.push("reportAlert");
    return Promise.resolve(this.result);
  }

  accountExpiry(to: EmailRecipient, deleteAt: Date) {
    this.sent.push(`expiry ${to.address} ${deleteAt.toISOString()} ${to.language}`);
    return Promise.resolve(this.result);
  }

  newLink(to: EmailRecipient, link: { title: string; url: string }) {
    this.sent.push(`newLink ${to.address} ${link.title}`);
    if (this.result === "sent") this.links.set(to.address, link.url);
    return Promise.resolve(this.result);
  }
}
