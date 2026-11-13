import type {
  ActorKeyFactory,
  ContributionNote,
  ContributionNoteFacts,
  ContributionNoteRepository,
  RemoteContributionRepository,
  FederationPublisher,
  FediverseProfile,
  FediverseProfileRepository,
  FollowerRepository,
  PlanEventView,
  ParticipantNote,
  ParticipantNoteFacts,
  ParticipantNoteRepository,
  PlanPublication,
  PublicationRepository,
  PublicationState,
  RemoteActor,
  RemoteJoin,
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

/** Which plans were sent, in memory (D38, D39). */
export class FakePublications implements PublicationRepository {
  readonly #states = new Map<string, PublicationState>();

  find(planId: string) {
    return Promise.resolve(this.#states.get(planId) ?? { kind: "none" as const });
  }

  findPublished(planIds: readonly string[]) {
    return Promise.resolve(
      planIds.flatMap((planId) => {
        const state = this.#states.get(planId);
        if (state?.kind !== "published") return [];
        const { kind: _, ...publication } = state;
        return [publication];
      }),
    );
  }

  publish(publication: PlanPublication) {
    this.#states.set(publication.planId, { kind: "published", ...publication });
    return Promise.resolve();
  }

  /** As in the database: only a plan that was sent can be withdrawn. */
  withdraw(planId: string) {
    if (this.#states.get(planId)?.kind === "published") {
      this.#states.set(planId, { kind: "withdrawn" });
    }
    return Promise.resolve();
  }

  withdrawAllBy(localActor: string) {
    for (const [planId, state] of this.#states) {
      if (state.kind === "published" && state.localActor === localActor) {
        this.#states.set(planId, { kind: "withdrawn" });
      }
    }
    return Promise.resolve();
  }
}

/** Private Notes to remote participants in memory (decision D43), the token kept in the clear. */
export class FakeParticipantNotes implements ParticipantNoteRepository {
  readonly notes = new Map<string, ParticipantNote>();

  create(note: Omit<ParticipantNote, "sentAt">, now: Date) {
    // One Note per response: a second attempt stores nothing, as the database does.
    if (this.notes.has(note.responseId)) return Promise.resolve(false);
    if ([...this.notes.values()].some((other) => other.noteId === note.noteId)) {
      return Promise.reject(new Error("duplicate key"));
    }
    this.notes.set(note.responseId, { ...note, sentAt: now });
    return Promise.resolve(true);
  }

  find(responseId: string) {
    const note = this.notes.get(responseId);
    return Promise.resolve(note === undefined ? undefined : { ...note });
  }

  findByNoteId(noteId: string) {
    const note = [...this.notes.values()].find((candidate) => candidate.noteId === noteId);
    return Promise.resolve(note === undefined ? undefined : { ...note });
  }

  listByPlan(planId: string) {
    return Promise.resolve(
      [...this.notes.values()].filter((note) => note.planId === planId).map((n) => ({ ...n })),
    );
  }

  listByActor(localActor: string) {
    return Promise.resolve(
      [...this.notes.values()]
        .filter((note) => note.localActor === localActor)
        .map((n) => ({ ...n })),
    );
  }

  update(note: Omit<ParticipantNote, "sentAt">) {
    const before = this.notes.get(note.responseId);
    if (before !== undefined) this.notes.set(note.responseId, { ...note, sentAt: before.sentAt });
    return Promise.resolve();
  }

  delete(responseId: string) {
    this.notes.delete(responseId);
    return Promise.resolve();
  }

  findByRouteToken(token: string) {
    const note = [...this.notes.values()].find((candidate) => candidate.routeToken === token);
    return Promise.resolve(note === undefined ? undefined : { ...note });
  }

  fingerprint(content: string) {
    return `fp(${content})`;
  }
}

/** Contribution Notes sent to remote participants in memory (decision D44), by note id. */
export class FakeContributionNotes implements ContributionNoteRepository {
  readonly notes = new Map<string, ContributionNote>();

  create(note: Omit<ContributionNote, "sentAt">, now: Date) {
    // One Note per contribution and recipient: a second attempt stores nothing, as the database does.
    if (
      [...this.notes.values()].some(
        (other) =>
          other.contributionId === note.contributionId && other.responseId === note.responseId,
      )
    ) {
      return Promise.resolve(false);
    }
    if (this.notes.has(note.noteId)) return Promise.reject(new Error("duplicate key"));
    this.notes.set(note.noteId, { ...note, sentAt: now });
    return Promise.resolve(true);
  }

  find(contributionId: string, responseId: string) {
    return Promise.resolve(
      this.#where((n) => n.contributionId === contributionId && n.responseId === responseId)[0],
    );
  }

  findByNoteId(noteId: string) {
    const note = this.notes.get(noteId);
    return Promise.resolve(note === undefined ? undefined : { ...note });
  }

  listByContribution(contributionId: string) {
    return Promise.resolve(this.#where((n) => n.contributionId === contributionId));
  }

  listByRecipient(responseId: string) {
    return Promise.resolve(this.#where((n) => n.responseId === responseId));
  }

  listByPlan(planId: string) {
    return Promise.resolve(this.#where((n) => n.planId === planId));
  }

  listByActor(localActor: string) {
    return Promise.resolve(this.#where((n) => n.localActor === localActor));
  }

  update(note: Pick<ContributionNote, "noteId" | "localActor" | "contentHash">) {
    const before = this.notes.get(note.noteId);
    if (before !== undefined) {
      this.notes.set(note.noteId, {
        ...before,
        localActor: note.localActor,
        contentHash: note.contentHash,
      });
    }
    return Promise.resolve();
  }

  delete(noteId: string) {
    this.notes.delete(noteId);
    return Promise.resolve();
  }

  fingerprint(content: string) {
    return `fp(${content})`;
  }

  #where(matches: (note: ContributionNote) => boolean): ContributionNote[] {
    return [...this.notes.values()].filter(matches).map((note) => ({ ...note }));
  }
}

/** Reply Notes mapped to their contributions in memory (decision D44); the Note id in the clear. */
export class FakeRemoteContributions implements RemoteContributionRepository {
  readonly mappings = new Map<string, { contributionId: string; planId: string }>();

  create(mapping: {
    contributionId: string;
    responseId: string;
    planId: string;
    remoteNoteId: string;
  }) {
    const key = `${mapping.responseId}|${mapping.remoteNoteId}`;
    if (this.mappings.has(key)) return Promise.resolve(false);
    this.mappings.set(key, { contributionId: mapping.contributionId, planId: mapping.planId });
    return Promise.resolve(true);
  }

  findContribution(responseId: string, remoteNoteId: string) {
    return Promise.resolve(this.mappings.get(`${responseId}|${remoteNoteId}`)?.contributionId);
  }
}

type SentPlan = PlanPublication & { to: string[] };

/** What would have been sent, in order. */
export class FakePublisher implements FederationPublisher {
  readonly sent: (
    | { kind: "accept"; localActor: string; followId: string; to: string }
    | { kind: "deleteActor"; localActor: string; to: string[] }
    | ({ kind: "create" | "update"; event: PlanEventView; language: string } & SentPlan)
    | ({ kind: "withdraw" } & SentPlan)
    | {
        kind: "answer";
        answer: "accept" | "reject";
        localActor: string;
        planId: string;
        responseId: string | undefined;
        to: string;
        join: RemoteJoin;
        language: string;
      }
    /** A private Note to one participant (decision D43). */
    | {
        kind: "note";
        activity: "create" | "update";
        localActor: string;
        note: ParticipantNoteFacts;
        to: string;
      }
    | {
        kind: "noteDelete";
        noteId: string;
        planId: string;
        localActor: string;
        to: string;
        /** Whether the actor's key goes in the job, for a profile being retired. */
        carryKey: boolean;
      }
    /** A recap contribution as a direct Note to one participant (decision D44). */
    | {
        kind: "contributionNote";
        activity: "create" | "update";
        localActor: string;
        note: ContributionNoteFacts;
        to: string;
      }
    | {
        kind: "contributionNoteDelete";
        noteId: string;
        planId: string;
        localActor: string;
        to: string;
        carryKey: boolean;
      }
    /** To remote participants only (decision D42). */
    | {
        kind: "participantsUpdate";
        localActor: string;
        planId: string;
        event: PlanEventView;
        to: string[];
      }
    | { kind: "participantsDelete"; localActor: string; planId: string; to: string[] }
    /** A direct message to an account's own inbox (decision D47). */
    | {
        kind: "accountNotice";
        localActor: "instance";
        identityId: string;
        channelId: string;
        handle: string;
        text: string;
        to: RemoteActor;
      }
  )[] = [];

  /** What was sent about plans, as kind and audience, e.g. "create public". */
  get planActivities(): string[] {
    return this.sent.flatMap((sent) =>
      sent.kind === "create" || sent.kind === "update" || sent.kind === "withdraw"
        ? [`${sent.kind} ${sent.audience}`]
        : [],
    );
  }

  sendPlan(
    activity: "create" | "update",
    publication: PlanPublication & { event: PlanEventView; language: string },
    followers: readonly RemoteActor[],
  ) {
    this.sent.push({ kind: activity, ...publication, to: followers.map((f) => f.id) });
    return Promise.resolve();
  }

  sendAccountNotice(
    recipient: RemoteActor,
    notice: { identityId: string; channelId: string; handle: string; text: string },
  ) {
    this.sent.push({ kind: "accountNotice", localActor: "instance", ...notice, to: recipient });
    return Promise.resolve();
  }

  withdrawPlan(publication: PlanPublication, followers: readonly RemoteActor[]) {
    this.sent.push({ kind: "withdraw", ...publication, to: followers.map((f) => f.id) });
    return Promise.resolve();
  }

  answerJoin(
    answer: "accept" | "reject",
    sender: {
      localActor: string;
      planId: string;
      responseId?: string | undefined;
      language: string;
    },
    participant: { actor: RemoteActor; join: RemoteJoin },
  ) {
    this.sent.push({
      kind: "answer",
      answer,
      localActor: sender.localActor,
      planId: sender.planId,
      responseId: sender.responseId,
      to: participant.actor.id,
      join: participant.join,
      language: sender.language,
    });
    return Promise.resolve();
  }

  sendParticipantNote(
    activity: "create" | "update",
    note: ParticipantNoteFacts,
    recipient: RemoteActor,
  ) {
    this.sent.push({
      kind: "note",
      activity,
      localActor: note.localActor,
      note: { ...note },
      to: recipient.id,
    });
    return Promise.resolve();
  }

  withdrawParticipantNote(
    note: { noteId: string; planId: string; localActor: string },
    recipient: RemoteActor,
    options: { carryKey?: boolean } = {},
  ) {
    this.sent.push({
      kind: "noteDelete",
      ...note,
      to: recipient.id,
      carryKey: options.carryKey === true,
    });
    return Promise.resolve();
  }

  sendContributionNote(
    activity: "create" | "update",
    note: ContributionNoteFacts,
    recipient: RemoteActor,
  ) {
    this.sent.push({
      kind: "contributionNote",
      activity,
      localActor: note.localActor,
      note: { ...note },
      to: recipient.id,
    });
    return Promise.resolve();
  }

  withdrawContributionNote(
    note: { noteId: string; planId: string; localActor: string },
    recipient: RemoteActor,
    options: { carryKey?: boolean } = {},
  ) {
    this.sent.push({
      kind: "contributionNoteDelete",
      ...note,
      to: recipient.id,
      carryKey: options.carryKey === true,
    });
    return Promise.resolve();
  }

  updateForParticipants(
    plan: { planId: string; localActor: string; event: PlanEventView },
    participants: readonly RemoteActor[],
  ) {
    this.sent.push({
      kind: "participantsUpdate",
      localActor: plan.localActor,
      planId: plan.planId,
      event: plan.event,
      to: participants.map((p) => p.id),
    });
    return Promise.resolve();
  }

  deleteForParticipants(
    plan: { planId: string; localActor: string },
    participants: readonly RemoteActor[],
  ) {
    this.sent.push({
      kind: "participantsDelete",
      localActor: plan.localActor,
      planId: plan.planId,
      to: participants.map((p) => p.id),
    });
    return Promise.resolve();
  }

  acceptFollow(localActor: string, follow: { id: string; follower: RemoteActor }) {
    this.sent.push({ kind: "accept", localActor, followId: follow.id, to: follow.follower.id });
    return Promise.resolve();
  }

  deleteActor(localActor: string, followers: readonly RemoteActor[]) {
    this.sent.push({ kind: "deleteActor", localActor, to: followers.map((f) => f.id) });
    return Promise.resolve();
  }
}
