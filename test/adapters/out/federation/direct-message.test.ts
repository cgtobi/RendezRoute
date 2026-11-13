// The fediverse direct-message outbox (decision D47): each message finds its recipient again and
// maps what the lookup says to what the job runner does; and the channel notifier never lets a
// plan notice through to an account's channel.
import { describe, expect, it } from "vite-plus/test";
import { createChannelNotifier } from "../../../../src/adapters/out/channel-notifier.ts";
import { createFediverseDirectMessages } from "../../../../src/adapters/out/federation/direct-message.ts";
import type {
  RemoteActor,
  RemoteActorLookup,
  FediverseDmChannel,
  FediverseDmRecipient,
} from "../../../../src/application/ports.ts";
import type { Identity } from "../../../../src/domain/identity.ts";
import type { Notification } from "../../../../src/domain/notification.ts";
import { FakeChannelRepository } from "../../../fakes/channels.ts";
import { FakePublisher } from "../../../fakes/fediverse-profiles.ts";
import { FakeNotifier } from "../../../fakes/notifier.ts";

const ACTOR: RemoteActor = {
  id: "https://social.example/users/anna",
  inbox: "https://social.example/users/anna/inbox",
  sharedInbox: undefined,
};
const identity = (over: Partial<Identity> = {}): Identity => ({
  id: "identity-1",
  provider: "fediverse",
  subject: "social.example 109",
  handle: "@anna@social.example",
  displayName: "Anna",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  lastActiveAt: new Date("2026-01-01T00:00:00Z"),
  ...over,
});
const to: FediverseDmRecipient = {
  kind: "fediverse_dm",
  channelId: "channel-1",
  identityId: "identity-1",
  language: "en",
};

const CHANNEL: FediverseDmChannel = {
  id: "channel-1",
  owner: { identityId: "identity-1" },
  kind: "fediverse_dm",
  verified: true,
  language: "en",
};

function outbox(
  stored: Identity | undefined,
  answer: Awaited<ReturnType<RemoteActorLookup["resolve"]>>,
  channel: FediverseDmChannel | null = CHANNEL,
) {
  const publisher = new FakePublisher();
  const asked: string[] = [];
  const messages = createFediverseDirectMessages({
    lookup: {
      resolve: (handle) => {
        asked.push(handle);
        return Promise.resolve(answer);
      },
    },
    publisher,
    identities: { findById: () => Promise.resolve(stored) },
    channels: { findById: () => Promise.resolve(channel ?? undefined) },
    instanceName: "Isar Runs",
    baseUrl: new URL("https://runs.example.org"),
    timeZone: "Europe/Berlin",
  });
  return { messages, publisher, asked };
}

describe("the fediverse direct-message outbox", () => {
  it("looks the identity's handle up and queues one message to the actor's own inbox", async () => {
    const { messages, publisher, asked } = outbox(identity(), { kind: "found", actor: ACTOR });
    expect(await messages.confirmation(to, { kind: "account" })).toBe("sent");
    expect(asked).toEqual(["@anna@social.example"]);
    expect(publisher.sent).toHaveLength(1);
    expect(publisher.sent[0]).toMatchObject({
      kind: "accountNotice",
      to: ACTOR,
      identityId: "identity-1",
    });
  });

  it.each([
    ["is unreachable for now", { kind: "unavailable" }, "retry"],
    ["is not found", { kind: "not_found" }, "failed"],
  ] as const)("says %s: %s -> %s, and queues nothing", async (_, answer, result) => {
    const { messages, publisher } = outbox(identity(), answer);
    expect(await messages.accountExpiry(to, new Date("2027-01-01T00:00:00Z"))).toBe(result);
    expect(publisher.sent).toEqual([]);
  });

  it("says the channel is gone when the account is, and fails for a login that names no address", async () => {
    const gone = outbox(undefined, { kind: "found", actor: ACTOR });
    expect(await gone.messages.confirmation(to, { kind: "account" })).toBe("gone");
    expect(gone.asked).toEqual([]);
    for (const other of [
      identity({ provider: "oidc", handle: undefined }),
      identity({ handle: undefined }),
    ]) {
      const { messages, asked, publisher } = outbox(other, { kind: "found", actor: ACTOR });
      expect(await messages.confirmation(to, { kind: "account" })).toBe("failed");
      expect(asked).toEqual([]);
      expect(publisher.sent).toEqual([]);
    }
  });
});

describe("a message whose account changed during the lookup", () => {
  it("is not queued when the channel is gone by then, or the account is", async () => {
    const noChannel = outbox(identity(), { kind: "found", actor: ACTOR }, null);
    expect(await noChannel.messages.confirmation(to, { kind: "account" })).toBe("failed");
    expect(noChannel.publisher.sent).toEqual([]);
    // The account is there when the lookup starts and gone when it ends.
    let reads = 0;
    const publisher = new FakePublisher();
    const messages = createFediverseDirectMessages({
      lookup: { resolve: () => Promise.resolve({ kind: "found", actor: ACTOR }) },
      publisher,
      identities: { findById: () => Promise.resolve(++reads === 1 ? identity() : undefined) },
      channels: { findById: () => Promise.resolve(CHANNEL) },
      instanceName: "Isar Runs",
      baseUrl: new URL("https://runs.example.org"),
      timeZone: "Europe/Berlin",
    });
    expect(await messages.confirmation(to, { kind: "account" })).toBe("gone");
    expect(publisher.sent).toEqual([]);
  });

  it("names its channel in what it queues, so only that channel's messages stay valid", async () => {
    const { messages, publisher } = outbox(identity(), { kind: "found", actor: ACTOR });
    await messages.confirmation(to, { kind: "account" });
    expect(publisher.sent[0]).toMatchObject({ identityId: "identity-1", channelId: "channel-1" });
  });
});

describe("the channel notifier and an account's fediverse channel", () => {
  it("lets no notification through: plan notices are never sent there", async () => {
    const channels = new FakeChannelRepository();
    const { id } = await channels.setFediverseDm({ identityId: "identity-1" }, "en");
    const push = new FakeNotifier();
    const notifier = createChannelNotifier({
      channels,
      push,
      email: undefined,
      ntfy: undefined,
      telegram: undefined,
    });
    const notification: Notification = {
      kind: "changed",
      planTitle: "Hill repeats",
      planPath: "/p/abc",
      language: "en",
    };
    expect(await notifier.send({ channelId: id }, notification)).toBe("failed");
    expect(push.sent).toEqual([]);
  });
});
