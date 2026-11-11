// One Notifier for the job runner (spec 2a: one adapter per channel kind): a stored channel is read
// once and handed to browser push, email or ntfy by its kind (decisions D31, D33); subscriptions,
// addresses and topics carried by a job go straight to theirs.
import type { ChannelRepository, Notifier } from "../../application/ports.ts";
import type { EmailDelivery } from "./email/notifier.ts";
import type { NtfyDelivery } from "./ntfy/notifier.ts";

export function createChannelNotifier({
  channels,
  push,
  email,
  ntfy,
}: {
  channels: ChannelRepository;
  push: Notifier;
  /** Undefined without SMTP or NTFY_URL: their channels then get nothing and stay. */
  email: EmailDelivery | undefined;
  ntfy: NtfyDelivery | undefined;
}): Notifier {
  const off = () => Promise.resolve("failed" as const);
  return {
    async send(to, notification) {
      if ("subscription" in to) return push.send(to, notification);
      if ("email" in to) {
        return (
          email?.send({ address: to.email.address, channelId: undefined }, notification) ?? off()
        );
      }
      if ("ntfy" in to) {
        return ntfy?.send({ ...to.ntfy, channelId: undefined }, notification) ?? off();
      }
      const channel = await channels.findById(to.channelId);
      if (channel === undefined) return "gone";
      // Nothing but the confirmation link before the owner confirmed the channel (spec 3.11).
      if (!channel.verified) return "failed";
      switch (channel.kind) {
        case "webpush":
          return push.send({ subscription: channel.subscription }, notification);
        case "email":
          return (
            email?.send({ address: channel.address, channelId: channel.id }, notification) ?? off()
          );
        case "ntfy":
          return (
            ntfy?.send(
              { topic: channel.topic, server: channel.server, channelId: channel.id },
              notification,
            ) ?? off()
          );
      }
    },
  };
}
