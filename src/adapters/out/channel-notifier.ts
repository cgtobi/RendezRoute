// One Notifier for the job runner (spec 2a: one adapter per channel kind): a stored channel is read
// once and handed to browser push or email by its kind (decision D31); subscriptions and addresses
// carried by a job go straight to theirs.
import type { ChannelRepository, Notifier } from "../../application/ports.ts";
import type { EmailDelivery } from "./email/notifier.ts";

export function createChannelNotifier({
  channels,
  push,
  email,
}: {
  channels: ChannelRepository;
  push: Notifier;
  /** Undefined without SMTP: email channels then get nothing and stay. */
  email: EmailDelivery | undefined;
}): Notifier {
  return {
    async send(to, notification) {
      if ("subscription" in to) return push.send(to, notification);
      if ("email" in to) {
        return email === undefined
          ? "failed"
          : email.send({ address: to.email.address, channelId: undefined }, notification);
      }
      const channel = await channels.findById(to.channelId);
      if (channel === undefined) return "gone";
      // Nothing but the confirmation link before the owner confirmed the channel (spec 3.11).
      if (!channel.verified) return "failed";
      if (channel.kind === "webpush") {
        return push.send({ subscription: channel.subscription }, notification);
      }
      if (email === undefined) return "failed";
      return email.send({ address: channel.address, channelId: channel.id }, notification);
    },
  };
}
