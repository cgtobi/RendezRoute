import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createChannelNotifier } from "../../../../src/adapters/out/channel-notifier.ts";
import {
  createEmailDelivery,
  createEmailOutbox,
  type EmailDelivery,
} from "../../../../src/adapters/out/email/notifier.ts";
import type { SendResult } from "../../../../src/application/ports.ts";
import type { Notification } from "../../../../src/domain/notification.ts";
import { FakeChannelLinks } from "../../../fakes/channel-links.ts";
import { FakeChannelRepository } from "../../../fakes/channels.ts";
import { FakeMailer } from "../../../fakes/mailer.ts";
import { FakeNotifier } from "../../../fakes/notifier.ts";

const notification: Notification = {
  kind: "changed",
  planTitle: "Hill repeats",
  planPath: "/p/abc",
  language: "en",
};
const instance = { baseUrl: new URL("https://runs.example.org"), instanceName: "Isar Runs" };
const KEYS = { p256dh: "B", auth: "A" };

let channels: FakeChannelRepository;
let mailer: FakeMailer;
beforeEach(() => {
  channels = new FakeChannelRepository();
  mailer = new FakeMailer();
});

const delivery = () => createEmailDelivery({ mailer, links: new FakeChannelLinks(), ...instance });

describe("email delivery (decision D31)", () => {
  it("sends with the channel's link to turn the emails off", async () => {
    expect(
      await delivery().send({ address: "ben@example.org", channelId: "c1" }, notification),
    ).toBe("sent");
    const [mail] = mailer.sent;
    expect(mail?.to).toBe("ben@example.org");
    expect(mail?.text).toContain("https://runs.example.org/e/link-c1");
    expect(mail?.headers["List-Unsubscribe"]).toBe("<https://runs.example.org/e/link-c1>");
  });

  it("sends the last email without a link once the channel is gone with its plan", async () => {
    await delivery().send(
      { address: "ben@example.org", channelId: undefined },
      { ...notification, kind: "deleted", planPath: undefined },
    );
    const [mail] = mailer.sent;
    expect(mail?.text).not.toContain("/e/");
    expect(mail?.headers["List-Unsubscribe"]).toBeUndefined();
  });

  it("passes the mail server's answer on", async () => {
    for (const result of ["retry", "gone", "failed"] as const) {
      mailer.result = result;
      expect(
        await delivery().send({ address: "ben@example.org", channelId: "c1" }, notification),
      ).toBe(result);
    }
  });
});

describe("email outbox (decision D31, spec 7 Moderation)", () => {
  it("sends the confirmation link to the new address", async () => {
    const outbox = createEmailOutbox({
      mailer,
      links: new FakeChannelLinks(),
      contactEmail: "owner@example.org",
      timeZone: "Europe/Berlin",
      adminUrl: instance.baseUrl,
      ...instance,
    });
    expect(
      await outbox.confirmation(
        { kind: "email", channelId: "c1", address: "ben@example.org", language: "de" },
        { kind: "plan", planTitle: "Hill repeats" },
      ),
    ).toBe("sent");
    expect(mailer.sent[0]?.to).toBe("ben@example.org");
    expect(mailer.sent[0]?.text).toContain("https://runs.example.org/e/link-c1");
  });

  it("sends report alerts to CONTACT_EMAIL, and none without it", async () => {
    const outbox = (contactEmail: string | undefined) =>
      createEmailOutbox({
        mailer,
        links: new FakeChannelLinks(),
        contactEmail,
        timeZone: "Europe/Berlin",
        adminUrl: instance.baseUrl,
        ...instance,
      });
    expect(await outbox("owner@example.org").reportAlert(4)).toBe("sent");
    expect(mailer.sent[0]?.text).toContain("4 reports are open.");
    expect(mailer.sent.map((mail) => mail.to)).toEqual(["owner@example.org"]);
    expect(mailer.sent[0]?.text).toContain("https://runs.example.org/admin/");
    expect(await outbox(undefined).reportAlert(4)).toBe("failed");
    expect(mailer.sent).toHaveLength(1);
  });
});

class FakeDelivery implements EmailDelivery {
  readonly sent: { address: string; channelId: string | undefined }[] = [];
  send(to: { address: string; channelId: string | undefined }) {
    this.sent.push(to);
    return Promise.resolve<SendResult>("sent");
  }
}

describe("channel notifier", () => {
  it("reads a stored channel once and hands it on by kind; carried targets go straight on", async () => {
    const push = new FakeNotifier();
    const email = new FakeDelivery();
    const notifier = createChannelNotifier({
      channels,
      push,
      email,
      ntfy: undefined,
      telegram: undefined,
    });
    const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/a", keys: KEYS };
    const pushId = await channels.add({ responseId: "r1" }, subscription);
    const emailId = await channels.setEmail({ responseId: "r1" }, "ben@example.org");
    await channels.confirm(emailId);
    await notifier.send({ channelId: pushId }, notification);
    await notifier.send({ channelId: emailId }, notification);
    const carried = { endpoint: "https://fcm.googleapis.com/fcm/send/b", keys: KEYS };
    await notifier.send({ subscription: carried }, notification);
    await notifier.send({ email: { address: "c@example.org" } }, notification);
    expect(push.sent.map(({ to }) => to)).toEqual([{ subscription }, { subscription: carried }]);
    expect(email.sent).toEqual([
      { address: "ben@example.org", channelId: emailId },
      { address: "c@example.org", channelId: undefined },
    ]);
    expect(await notifier.send({ channelId: "unknown" }, notification)).toBe("gone");
  });

  it("sends nothing to an unconfirmed channel, and no email without SMTP", async () => {
    const email = new FakeDelivery();
    const id = await channels.setEmail({ responseId: "r1" }, "ben@example.org");
    const withSmtp = createChannelNotifier({
      channels,
      push: new FakeNotifier(),
      email,
      ntfy: undefined,
      telegram: undefined,
    });
    expect(await withSmtp.send({ channelId: id }, notification)).toBe("failed");
    expect(email.sent).toEqual([]);
    await channels.confirm(id);
    const without = createChannelNotifier({
      channels,
      push: new FakeNotifier(),
      email: undefined,
      ntfy: undefined,
      telegram: undefined,
    });
    expect(await without.send({ channelId: id }, notification)).toBe("failed");
    expect(await without.send({ email: { address: "c@example.org" } }, notification)).toBe(
      "failed",
    );
  });
});
