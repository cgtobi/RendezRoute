// The secret in a confirmable channel's link (decisions D31, D33, D34): the channel id with an
// HMAC-SHA-256 of it, keyed with a key derived from the encryption key. Nothing is stored, so
// every message can carry the link; a made-up or altered token names no channel.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChannelLinks } from "../../../application/ports.ts";

/** Between id and signature; ids are UUIDs, so it cannot occur in one. */
const SEPARATOR = "_s_";
const MAX_TOKEN_LENGTH = 200;

export function createChannelLinks(key: Buffer): ChannelLinks {
  const sign = (channelId: string) =>
    createHmac("sha256", key).update(`email-channel:${channelId}`, "utf8").digest();
  const startSign = (channelId: string) =>
    createHmac("sha256", key)
      .update(`telegram-start:${channelId}`, "utf8")
      .digest()
      .subarray(0, 16);

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

    // Telegram's Start parameter: at most 64 of [A-Za-z0-9_-]. The UUID's 32 hex digits, then
    // 128 bits of an HMAC as 22 base64url characters (decision D34): the link's key, under a label
    // of its own, so neither can stand in for the other.
    startTokenFor(channelId) {
      const hex = channelId.replaceAll("-", "");
      return `${hex}${startSign(channelId).toString("base64url")}`;
    },
    channelOfStart(token) {
      const match = /^([0-9a-f]{32})([A-Za-z0-9_-]{22})$/.exec(token);
      if (match === null) return undefined;
      const [, hex = "", signature = ""] = match;
      const channelId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      const given = Buffer.from(signature, "utf8");
      const expected = Buffer.from(startSign(channelId).toString("base64url"), "utf8");
      return given.length === expected.length && timingSafeEqual(given, expected)
        ? channelId
        : undefined;
    },
  };
}
