import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { createChannelLinks } from "../../../../src/adapters/out/crypto/channel-links.ts";

const CHANNEL = "0190f2a4-7b1c-7cde-8f00-123456789abc";

describe("email channel links (decision D31)", () => {
  it("name their channel, signed with the instance key", () => {
    const links = createChannelLinks(randomBytes(32));
    const token = links.tokenFor(CHANNEL);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(links.channelOf(token)).toBe(CHANNEL);
    expect(links.tokenFor(CHANNEL)).toBe(token);
  });

  it("work for every key, also when the signature contains the separator", () => {
    // About one key in 6,000 gives a signature with "_s_"; try enough keys to meet several.
    const misses = Array.from({ length: 30_000 }, () => createChannelLinks(randomBytes(32))).filter(
      (links) => links.channelOf(links.tokenFor(CHANNEL)) !== CHANNEL,
    );
    expect(misses).toHaveLength(0);
  });

  it("refuse tokens made with another key, for another channel, or altered", () => {
    const key = randomBytes(32);
    const links = createChannelLinks(key);
    const token = links.tokenFor(CHANNEL);
    expect(createChannelLinks(randomBytes(32)).channelOf(token)).toBeUndefined();
    const other = links.tokenFor("0190f2a4-7b1c-7cde-8f00-000000000000");
    // The other channel's id with this channel's signature, and the reverse.
    const [, signature] = token.split("_s_");
    const [otherId] = other.split("_s_");
    expect(links.channelOf(`${otherId}_s_${signature}`)).toBeUndefined();
    // Every other last character, including those that decode to the same bytes.
    const last = token.at(-1) ?? "";
    const accepted = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
      .split("")
      .filter((swapped) => swapped !== last)
      .filter((swapped) => links.channelOf(token.slice(0, -1) + swapped) !== undefined);
    expect(accepted).toEqual([]);
    for (const made of ["", "_s_", CHANNEL, `${CHANNEL}_s_`, "x".repeat(500)]) {
      expect(links.channelOf(made)).toBeUndefined();
    }
  });
});
