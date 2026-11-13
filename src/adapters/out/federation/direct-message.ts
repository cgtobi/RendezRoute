// The outbox of the fediverse direct-message channel (spec 7 Optional notification channels,
// decision D47). Each message finds the recipient again: the account's login handle (decrypted
// with its identity) is looked up by WebFinger and the actor's own inbox read, and the message is
// queued as a delivery from the instance actor. Nothing about the recipient is kept. A lookup
// that may be temporary makes the job try again on its schedule; an answer that is final (no such
// account, a server not trusted) drops the message and leaves the channel, which the person may
// switch off; an account that is gone has no channel.
import type {
  FederationPublisher,
  ChannelRepository,
  FediverseDmOutbox,
  IdentityRepository,
  RemoteActorLookup,
  SendResult,
} from "../../../application/ports.ts";
import { formatDate } from "../../i18n/dates.ts";
import { negotiateLanguage, translator } from "../../i18n/i18n.ts";
import type { MessageInstance } from "../instance.ts";

export function createFediverseDirectMessages({
  lookup,
  publisher,
  identities,
  channels,
  timeZone,
  ...instance
}: MessageInstance & {
  lookup: RemoteActorLookup;
  publisher: Pick<FederationPublisher, "sendAccountNotice">;
  identities: Pick<IdentityRepository, "findById">;
  /** To see that the channel is still there once the lookup is done. */
  channels: Pick<ChannelRepository, "findById">;
  /** Dates that belong to no plan, such as an account's deletion: DEFAULT_TIMEZONE. */
  timeZone: string;
}): FediverseDmOutbox {
  const accountLink = new URL("/account", instance.baseUrl).href;

  async function send(
    to: { identityId: string; channelId: string; language: string },
    text: (
      t: ReturnType<typeof translator>,
      language: ReturnType<typeof negotiateLanguage>,
    ) => string,
  ): Promise<SendResult> {
    const identity = await identities.findById(to.identityId);
    if (identity === undefined) return "gone";
    // Only a fediverse login names an address; nothing else is ever written to.
    if (identity.provider !== "fediverse" || identity.handle === undefined) return "failed";
    const found = await lookup.resolve(identity.handle);
    if (found.kind === "unavailable") return "retry";
    if (found.kind === "not_found") return "failed";
    // The lookup took a while: the account may have been deleted, or the channel switched off (or
    // off and on again, which makes another channel), meanwhile. Then nothing is queued.
    if ((await identities.findById(to.identityId)) === undefined) return "gone";
    if ((await channels.findById(to.channelId)) === undefined) return "failed";
    const language = negotiateLanguage(to.language);
    await publisher.sendAccountNotice(found.actor, {
      identityId: identity.id,
      channelId: to.channelId,
      handle: identity.handle,
      text: text(translator(language), language),
    });
    return "sent";
  }

  return {
    // Nothing is confirmed: this is the one message that tells the person the channel is on.
    confirmation: (to) =>
      send(to, (t) =>
        [
          t("fediverseDm.first", { instance: instance.instanceName }),
          t("fediverseDm.keeps"),
          t("fediverseDm.turnOff", { link: accountLink }),
        ].join("\n\n"),
      ),
    // The date and the instance's name, as in the other channels' warnings; nothing of any plan.
    accountExpiry: (to, deleteAt) =>
      send(to, (t, language) => {
        const date = formatDate(deleteAt, timeZone, language);
        return [
          t("notice.expirySubject", { instance: instance.instanceName, date }),
          t("notice.expiryBody", { date }),
          t("fediverseDm.turnOff", { link: accountLink }),
        ].join("\n\n");
      }),
  };
}
