import type {
  ActorKeyFactory,
  FederationPublisher,
  FediverseProfile,
  FediverseProfileRepository,
  FollowerRepository,
  RemoteActor,
} from "../../src/application/ports.ts";

/**
 * Profiles in memory; a retired one keeps its identifier and its handle as taken (D37), and its
 * followers go with it, as in the database (D38).
 */
export class FakeFediverseProfiles implements FediverseProfileRepository {
  readonly profiles = new Map<string, FediverseProfile & { keys: string; retiredAt?: Date }>();
  readonly #taken = new Set<string>();
  readonly #followers: FakeFollowers | undefined;

  constructor(followers?: FakeFollowers) {
    this.#followers = followers;
  }

  findActive(identityId: string) {
    return Promise.resolve(this.#active().find((p) => p.identityId === identityId));
  }

  findByHandle(handle: string) {
    return Promise.resolve(this.#active().find((p) => p.handle === handle));
  }

  findActor(id: string) {
    const stored = this.profiles.get(id);
    if (stored === undefined) return Promise.resolve(undefined);
    if (stored.retiredAt !== undefined) {
      return Promise.resolve({ kind: "retired" as const, retiredAt: stored.retiredAt });
    }
    const { keys, retiredAt: _r, ...profile } = stored;
    return Promise.resolve({ kind: "active" as const, profile, keys });
  }

  isTaken(profile: { identityId: string; handle: string }) {
    return Promise.resolve(
      this.#taken.has(profile.handle) ||
        this.#active().some((p) => p.identityId === profile.identityId),
    );
  }

  async create(profile: FediverseProfile & { keys: string }) {
    if (await this.isTaken(profile)) return "taken" as const;
    this.#taken.add(profile.handle);
    this.profiles.set(profile.id, { ...profile });
    return "created" as const;
  }

  retire(identityId: string, now: Date) {
    const profile = this.#active().find((p) => p.identityId === identityId);
    if (profile === undefined) return Promise.resolve(undefined);
    this.profiles.set(profile.id, { ...this.profiles.get(profile.id)!, retiredAt: now });
    this.#followers?.removeAllOf(profile.id);
    return Promise.resolve(profile.id);
  }

  #active(): FediverseProfile[] {
    return [...this.profiles.values()]
      .filter((p) => p.retiredAt === undefined)
      .map(({ keys: _k, retiredAt: _r, ...profile }) => profile);
  }
}

/** Readable keys: "keys-1", "keys-2", … */
export class FakeActorKeys implements ActorKeyFactory {
  #n = 0;
  generate() {
    return Promise.resolve(`keys-${++this.#n}`);
  }

  /** How many key sets were made. */
  get made(): number {
    return this.#n;
  }
}

/** Followers in memory, by local actor and remote actor address (D38). */
export class FakeFollowers implements FollowerRepository {
  readonly #byActor = new Map<string, Map<string, RemoteActor>>();

  add(localActor: string, follower: RemoteActor) {
    const followers = this.#byActor.get(localActor) ?? new Map<string, RemoteActor>();
    followers.set(follower.id, follower);
    this.#byActor.set(localActor, followers);
    return Promise.resolve();
  }

  remove(localActor: string, remoteActorId: string) {
    this.#byActor.get(localActor)?.delete(remoteActorId);
    return Promise.resolve();
  }

  forget(remoteActorId: string) {
    let removed = 0;
    for (const followers of this.#byActor.values()) {
      if (followers.delete(remoteActorId)) removed++;
    }
    return Promise.resolve(removed);
  }

  count(localActor: string) {
    return Promise.resolve(this.#byActor.get(localActor)?.size ?? 0);
  }

  list(localActor: string) {
    return Promise.resolve([...(this.#byActor.get(localActor)?.values() ?? [])]);
  }

  clear() {
    const removed = [...this.#byActor.values()].reduce((n, followers) => n + followers.size, 0);
    this.#byActor.clear();
    return Promise.resolve(removed);
  }

  /** What retiring a profile does to its followers. */
  removeAllOf(localActor: string) {
    this.#byActor.delete(localActor);
  }
}

/** What would have been sent, in order. */
export class FakePublisher implements FederationPublisher {
  readonly sent: (
    | { kind: "accept"; localActor: string; followId: string; to: string }
    | { kind: "deleteActor"; localActor: string; to: string[] }
  )[] = [];

  acceptFollow(localActor: string, follow: { id: string; follower: RemoteActor }) {
    this.sent.push({ kind: "accept", localActor, followId: follow.id, to: follow.follower.id });
    return Promise.resolve();
  }

  deleteActor(localActor: string, followers: readonly RemoteActor[]) {
    this.sent.push({ kind: "deleteActor", localActor, to: followers.map((f) => f.id) });
    return Promise.resolve();
  }
}
