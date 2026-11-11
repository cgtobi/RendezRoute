import type {
  ActorKeyFactory,
  FediverseProfile,
  FediverseProfileRepository,
} from "../../src/application/ports.ts";

/** Profiles in memory; a retired one keeps its identifier and its handle as taken (D37). */
export class FakeFediverseProfiles implements FediverseProfileRepository {
  readonly profiles = new Map<string, FediverseProfile & { keys: string; retiredAt?: Date }>();
  readonly #taken = new Set<string>();

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
