import type {
  ChannelOwner,
  ChannelRepository,
  EmailChannel,
  NotificationChannel,
  PushChannel,
} from "../../src/application/ports.ts";
import type { PushSubscription } from "../../src/domain/push.ts";

const ownerKey = (owner: ChannelOwner) =>
  "responseId" in owner
    ? `response:${owner.responseId}`
    : "planId" in owner
      ? `plan:${owner.planId}`
      : `identity:${owner.identityId}`;

/** In-memory channels; tests delete them per owner to mimic the cascades. */
export class FakeChannelRepository implements ChannelRepository {
  readonly channels = new Map<string, NotificationChannel>();
  /** The browser that made each channel. */
  readonly devices = new Map<string, string>();
  #next = 0;

  #owned(owner: ChannelOwner): NotificationChannel[] {
    return [...this.channels.values()].filter((c) => ownerKey(c.owner) === ownerKey(owner));
  }

  #push(owner: ChannelOwner, endpoint: string): PushChannel | undefined {
    return this.#owned(owner).find(
      (c): c is PushChannel => c.kind === "webpush" && c.subscription.endpoint === endpoint,
    );
  }

  add(owner: ChannelOwner, subscription: PushSubscription, deviceId?: string) {
    const existing = this.#push(owner, subscription.endpoint);
    if (existing !== undefined) return Promise.resolve(existing.id);
    const id = `channel-${++this.#next}`;
    this.channels.set(id, { id, owner, kind: "webpush", subscription, verified: true });
    if (deviceId !== undefined) this.devices.set(id, deviceId);
    return Promise.resolve(id);
  }

  removeForDevice(deviceId: string, owners: readonly ChannelOwner[]) {
    const keys = new Set(owners.map(ownerKey));
    for (const [id, c] of this.channels) {
      if (this.devices.get(id) === deviceId && keys.has(ownerKey(c.owner)))
        this.channels.delete(id);
    }
    return Promise.resolve();
  }

  remove(owner: ChannelOwner, endpoint: string) {
    const existing = this.#push(owner, endpoint);
    if (existing !== undefined) this.channels.delete(existing.id);
    return Promise.resolve();
  }

  has(owner: ChannelOwner, endpoint: string) {
    return Promise.resolve(this.#push(owner, endpoint) !== undefined);
  }

  listFor(owner: ChannelOwner) {
    return Promise.resolve(this.#owned(owner));
  }

  findById(id: string) {
    return Promise.resolve(this.channels.get(id));
  }

  delete(id: string) {
    this.channels.delete(id);
    return Promise.resolve();
  }

  setEmail(owner: ChannelOwner, address: string, language?: string) {
    for (const c of this.#owned(owner)) if (c.kind === "email") this.channels.delete(c.id);
    const id = `channel-${++this.#next}`;
    this.channels.set(id, { id, owner, kind: "email", address, language, verified: false });
    return Promise.resolve(id);
  }

  confirm(id: string) {
    const channel = this.channels.get(id);
    if (channel !== undefined) this.channels.set(id, { ...channel, verified: true });
    return Promise.resolve(channel !== undefined);
  }

  emailFor(owner: ChannelOwner) {
    return Promise.resolve(this.#owned(owner).find((c): c is EmailChannel => c.kind === "email"));
  }
}

/** A push channel's endpoint, for tests that list channels; undefined for email channels. */
export const endpointOf = (channel: NotificationChannel | undefined): string | undefined =>
  channel?.kind === "webpush" ? channel.subscription.endpoint : undefined;
