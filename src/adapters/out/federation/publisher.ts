// Activities to other servers (spec 7 ActivityPub; decisions D37, D38): built with Fedify's
// vocabulary here, queued once per inbox (a server's shared inbox where it has one) and delivered
// by the job runner through OutboundHttp (delivery.ts), signed with the local actor's key looked up
// then: the instance actor's never leaves the key directory (spec 2b). Only a retired actor's
// `Delete` carries its key in the job, encrypted like every payload, since the key is gone from the
// database once the job runs; it goes with the job, delivered or given up (D36).
import { exportJwk } from "@fedify/fedify";
import type { DocumentLoader } from "@fedify/fedify/runtime";
import {
  Accept,
  type Activity,
  Create,
  Delete,
  Follow,
  Join,
  PUBLIC_COLLECTION,
  Reject,
  TentativeAccept,
  Tombstone,
  Update,
} from "@fedify/fedify/vocab";
import type {
  Clock,
  FederationPublisher,
  IdGenerator,
  JobQueue,
  RemoteActor,
} from "../../../application/ports.ts";
import { actorUriOf, addressing, planEvent, planUriOf } from "./event.ts";
import { contributionNote } from "./contribution-note.ts";
import { copiesNotice, noteUriOf, participantNote } from "./note.ts";
import type { SigningKeyPair } from "../crypto/federation-keys.ts";

/**
 * Dropped unrun after this, should the job runner stop: a little over the 8.6 hours in which it
 * retries a delivery (domain/jobs.ts), so a key carried in a job is gone within half a day.
 */
const DELIVERY_HOURS = 12;

export interface DeliveryPayload {
  /** Who signs: "instance" or a poster actor's identifier. */
  localActor: string;
  inbox: string;
  /** The activity as compact JSON-LD. */
  body: string;
  keyId: string;
  /** Only for a retired actor's `Delete`: its RSA key as a JWK (Mastodon checks RSA signatures). */
  privateKey?: JsonWebKey | undefined;
  /**
   * Only for a private Note's `Create` or `Update`: sent only while that Note still exists, so
   * one waiting to be tried again cannot arrive after the Note's `Delete` (decision D43).
   */
  guard?: NoteGuard | undefined;
}

/**
 * What a guarded `Create` or `Update` waits on: a participant's private Note (by its response), or
 * a contribution Note (by its contribution), still existing with that identifier.
 */
export type NoteGuard =
  | { responseId: string; noteId: string }
  | { kind: "contribution"; contributionId: string; noteId: string };

/** A local actor's signing keys, RSA first; undefined when it has none (not, or no longer, active). */
export type ActorSigningKeys = (
  localActor: string,
) => Promise<readonly SigningKeyPair[] | undefined>;

/** The key id Fedify publishes for an actor's first (RSA) key. */
export const mainKeyId = (baseUrl: URL, localActor: string): string =>
  new URL("#main-key", actorUriOf(baseUrl, localActor)).href;

export function createFederationPublisher({
  jobs,
  clock,
  ids,
  baseUrl,
  keysFor,
  contextLoader,
}: {
  jobs: JobQueue;
  clock: Clock;
  ids: IdGenerator;
  baseUrl: URL;
  keysFor: ActorSigningKeys;
  contextLoader: DocumentLoader;
}): FederationPublisher {
  const actorUri = (localActor: string) => actorUriOf(baseUrl, localActor);

  async function enqueue(
    localActor: string,
    activity: Activity,
    recipients: readonly RemoteActor[],
    {
      carryKey = false,
      planId,
      responseId,
      guard,
    }: {
      carryKey?: boolean;
      planId?: string;
      responseId?: string | undefined;
      guard?: NoteGuard;
    } = {},
  ): Promise<void> {
    const rsa = (await keysFor(localActor))?.[0];
    // Nothing can be signed for an actor without keys.
    if (rsa === undefined || recipients.length === 0) return;
    const now = clock.now();
    const delivery = {
      localActor,
      body: JSON.stringify(await activity.toJsonLd({ format: "compact", contextLoader })),
      keyId: mainKeyId(baseUrl, localActor),
      privateKey: carryKey ? await exportJwk(rsa.privateKey) : undefined,
      guard,
    };
    for (const inbox of inboxesOf(recipients)) {
      const payload: DeliveryPayload = { inbox, ...delivery };
      await jobs.enqueue({
        type: "federationDelivery",
        payload,
        // A `Create` or `Update` not yet delivered goes with its plan; its `Delete` does not. An
        // `Accept` or `Reject` goes with the response it answers.
        planId,
        responseId,
        runAt: now,
        expiresAt: new Date(now.getTime() + DELIVERY_HOURS * 60 * 60 * 1000),
      });
    }
  }

  /** `Delete` with a `Tombstone` for a Note, to its one recipient; outlives its plan and rows. */
  async function withdrawNote(
    note: { noteId: string; localActor: string },
    recipient: RemoteActor,
    options: { carryKey?: boolean },
  ): Promise<void> {
    const actor = actorUri(note.localActor);
    await enqueue(
      note.localActor,
      new Delete({
        id: new URL(`#delete-${ids.rowId()}`, noteUriOf(baseUrl, note.noteId)),
        actor,
        object: new Tombstone({ id: noteUriOf(baseUrl, note.noteId) }),
        tos: [new URL(recipient.id)],
      }),
      [recipient],
      // A profile being retired has no key by delivery (decision D36).
      { carryKey: options.carryKey === true },
    );
  }

  return {
    async acceptFollow(localActor, follow) {
      const actor = actorUri(localActor);
      await enqueue(
        localActor,
        new Accept({
          id: new URL(`#accept-${ids.rowId()}`, actor),
          actor,
          to: new URL(follow.follower.id),
          object: new Follow({
            id: new URL(follow.id),
            actor: new URL(follow.follower.id),
            object: actor,
          }),
        }),
        [follow.follower],
      );
    },

    async deleteActor(localActor, followers) {
      const actor = actorUri(localActor);
      await enqueue(
        localActor,
        new Delete({
          id: new URL("#delete", actor),
          actor,
          to: PUBLIC_COLLECTION,
          object: actor,
        }),
        followers,
        // The actor is retired before this is delivered, its keys with it.
        { carryKey: true },
      );
    },

    async sendPlan(activity, publication, followers) {
      const actor = actorUri(publication.localActor);
      const object = planEvent(publication.event, publication.language, {
        baseUrl,
        localActor: publication.localActor,
        audience: publication.audience,
      });
      const Sent = activity === "create" ? Create : Update;
      await enqueue(
        publication.localActor,
        new Sent({
          id: new URL(`#${activity}-${ids.rowId()}`, planUriOf(baseUrl, publication.planId)),
          actor,
          object,
          ...addressing(actor, publication.audience),
        }),
        followers,
        { planId: publication.planId },
      );
    },

    async answerJoin(
      answer,
      { localActor, planId, responseId, language },
      { actor: remote, join },
    ) {
      const actor = actorUri(localActor);
      const Answer = answer === "accept" ? Accept : Reject;
      // Wrapping what was received, as the remote server knows it by its identifier.
      const Received = join.kind === "join" ? Join : TentativeAccept;
      await enqueue(
        localActor,
        new Answer({
          id: new URL(`#${answer}-${ids.rowId()}`, actor),
          actor,
          to: new URL(remote.id),
          // Told with the answer that their server may keep copies (decision D43).
          ...(answer === "accept" ? { summary: copiesNotice(language) } : {}),
          object: new Received({
            id: new URL(join.id),
            actor: new URL(remote.id),
            object: planUriOf(baseUrl, planId),
          }),
        }),
        [remote],
        { planId, responseId },
      );
    },

    // One activity per participant, addressed to that person only, so no server learns who else
    // took part (spec 3.6); delivered to the person's own inbox (its server's shared inbox, which
    // the body names nobody else for).
    async updateForParticipants(plan, participants) {
      const actor = actorUri(plan.localActor);
      for (const participant of participants) {
        await enqueue(
          plan.localActor,
          new Update({
            id: new URL(`#update-${ids.rowId()}`, planUriOf(baseUrl, plan.planId)),
            actor,
            object: planEvent(plan.event, plan.language, { baseUrl, localActor: plan.localActor }),
            tos: [new URL(participant.id)],
          }),
          [participant],
          { planId: plan.planId },
        );
      }
    },

    async deleteForParticipants(plan, participants) {
      const actor = actorUri(plan.localActor);
      for (const participant of participants) {
        await enqueue(
          plan.localActor,
          new Delete({
            id: new URL(`#delete-${ids.rowId()}`, planUriOf(baseUrl, plan.planId)),
            actor,
            object: new Tombstone({ id: planUriOf(baseUrl, plan.planId) }),
            tos: [new URL(participant.id)],
          }),
          [participant],
        );
      }
    },

    // The exact start and route, to one participant alone, from the plan's actor (decision D43).
    async sendParticipantNote(activity, note, recipient) {
      const actor = actorUri(note.localActor);
      const Sent = activity === "create" ? Create : Update;
      await enqueue(
        note.localActor,
        new Sent({
          id: new URL(`#${activity}-${ids.rowId()}`, noteUriOf(baseUrl, note.noteId)),
          actor,
          object: participantNote(note, { baseUrl, recipient: new URL(recipient.id) }),
          tos: [new URL(recipient.id)],
        }),
        [recipient],
        // Goes with the plan or the response if undelivered, and is dropped if the Note has been
        // withdrawn by then; the Delete below does neither.
        {
          planId: note.planId,
          responseId: note.responseId,
          guard: { responseId: note.responseId, noteId: note.noteId },
        },
      );
    },

    async withdrawParticipantNote(note, recipient, options = {}) {
      await withdrawNote(note, recipient, options);
    },

    // A recap contribution to one participant alone, `inReplyTo` the plan's `Event` (D44).
    async sendContributionNote(activity, note, recipient) {
      const actor = actorUri(note.localActor);
      const Sent = activity === "create" ? Create : Update;
      await enqueue(
        note.localActor,
        new Sent({
          id: new URL(`#${activity}-${ids.rowId()}`, noteUriOf(baseUrl, note.noteId)),
          actor,
          object: contributionNote(note, { baseUrl, recipient: new URL(recipient.id) }),
          tos: [new URL(recipient.id)],
        }),
        [recipient],
        // Goes with the plan or the recipient if undelivered, and is dropped if the Note has been
        // withdrawn by then; the Delete below does neither.
        {
          planId: note.planId,
          responseId: note.responseId,
          guard: { kind: "contribution", contributionId: note.contributionId, noteId: note.noteId },
        },
      );
    },

    async withdrawContributionNote(note, recipient, options = {}) {
      await withdrawNote(note, recipient, options);
    },

    async withdrawPlan(publication, followers) {
      const actor = actorUri(publication.localActor);
      const plan = planUriOf(baseUrl, publication.planId);
      await enqueue(
        publication.localActor,
        new Delete({
          id: new URL(`#delete-${ids.rowId()}`, plan),
          actor,
          object: new Tombstone({ id: plan }),
          ...addressing(actor, publication.audience),
        }),
        followers,
      );
    },
  };
}

/** One delivery per server: its shared inbox where it has one, else each actor's own. */
function inboxesOf(recipients: readonly RemoteActor[]): string[] {
  return [...new Set(recipients.map((actor) => actor.sharedInbox ?? actor.inbox))];
}
