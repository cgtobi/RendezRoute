import type {
  ChannelOwner,
  ChannelRepository,
  NotificationChannel,
} from "../../src/application/ports.ts";
import type { PushSubscription } from "../../src/domain/push.ts";

const ownerKey = (owner: ChannelOwner) =>
  "responseId" in owner ? `response:${owner.responseId}` : `plan:${owner.planId}`;

/** In-memory channels; tests delete them per owner to mimic the cascades. */
export class FakeChannelRepository implements ChannelRepository {
  readonly channels = new Map<string, NotificationChannel>();
  #next = 0;

  add(owner: ChannelOwner, subscription: PushSubscription) {
    const existing = [...this.channels.values()].find(
      (c) =>
        ownerKey(c.owner) === ownerKey(owner) && c.subscription.endpoint === subscription.endpoint,
    );
    if (existing !== undefined) return Promise.resolve(existing.id);
    const id = `channel-${++this.#next}`;
    this.channels.set(id, { id, owner, subscription });
    return Promise.resolve(id);
  }

  remove(owner: ChannelOwner, endpoint: string) {
    for (const [id, c] of this.channels) {
      if (ownerKey(c.owner) === ownerKey(owner) && c.subscription.endpoint === endpoint) {
        this.channels.delete(id);
      }
    }
    return Promise.resolve();
  }

  has(owner: ChannelOwner, endpoint: string) {
    return Promise.resolve(
      [...this.channels.values()].some(
        (c) => ownerKey(c.owner) === ownerKey(owner) && c.subscription.endpoint === endpoint,
      ),
    );
  }

  listFor(owner: ChannelOwner) {
    return Promise.resolve(
      [...this.channels.values()].filter((c) => ownerKey(c.owner) === ownerKey(owner)),
    );
  }

  findById(id: string) {
    return Promise.resolve(this.channels.get(id));
  }

  delete(id: string) {
    this.channels.delete(id);
    return Promise.resolve();
  }
}
