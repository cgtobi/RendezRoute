import type { ChannelLinks } from "../../src/application/ports.ts";

/** Readable tokens: "link-<channel id>". */
export class FakeChannelLinks implements ChannelLinks {
  tokenFor(channelId: string) {
    return `link-${channelId}`;
  }

  channelOf(token: string) {
    return token.startsWith("link-") ? token.slice("link-".length) : undefined;
  }

  startTokenFor(channelId: string) {
    return `start-${channelId}`;
  }

  channelOfStart(token: string) {
    return token.startsWith("start-") ? token.slice("start-".length) : undefined;
  }
}
