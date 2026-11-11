// The secret in an email channel's link (decision D31): the channel id with an HMAC-SHA-256 of it,
// keyed with a key derived from the encryption key. Nothing is stored, so every message can carry
// the link; a made-up or altered token names no channel.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChannelLinks } from "../../../application/ports.ts";

/** Between id and signature; ids are UUIDs, so it cannot occur in one. */
const SEPARATOR = "_s_";
const MAX_TOKEN_LENGTH = 200;

export function createChannelLinks(key: Buffer): ChannelLinks {
  const sign = (channelId: string) =>
    createHmac("sha256", key).update(`email-channel:${channelId}`, "utf8").digest();

  return {
    tokenFor: (channelId) => `${channelId}${SEPARATOR}${sign(channelId).toString("base64url")}`,
    channelOf(token) {
      if (token.length > MAX_TOKEN_LENGTH) return undefined;
      // The first one: the signature may contain the separator, an id never does.
      const at = token.indexOf(SEPARATOR);
      if (at <= 0) return undefined;
      const channelId = token.slice(0, at);
      // Compared as text: decoding would ignore the unused bits of the last character.
      const given = Buffer.from(token.slice(at + SEPARATOR.length), "utf8");
      const expected = Buffer.from(sign(channelId).toString("base64url"), "utf8");
      return given.length === expected.length && timingSafeEqual(given, expected)
        ? channelId
        : undefined;
    },
  };
}
