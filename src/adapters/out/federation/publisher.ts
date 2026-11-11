// Activities to other servers (spec 7 ActivityPub; decisions D37, D38): built with Fedify's
// vocabulary here, queued once per inbox (a server's shared inbox where it has one) and delivered
// by the job runner through OutboundHttp (delivery.ts), signed with the local actor's key looked up
// then: the instance actor's never leaves the key directory (spec 2b). Only a retired actor's
// `Delete` carries its key in the job, encrypted like every payload, since the key is gone from the
// database once the job runs; it goes with the job, delivered or given up (D36).
import { exportJwk } from "@fedify/fedify";
import type { DocumentLoader } from "@fedify/fedify/runtime";
import { Accept, type Activity, Delete, Follow, PUBLIC_COLLECTION } from "@fedify/fedify/vocab";
import type {
  Clock,
  FederationPublisher,
  IdGenerator,
  JobQueue,
  RemoteActor,
} from "../../../application/ports.ts";
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
}

/** A local actor's signing keys, RSA first; undefined when it has none (not, or no longer, active). */
export type ActorSigningKeys = (
  localActor: string,
) => Promise<readonly SigningKeyPair[] | undefined>;

/** The key id Fedify publishes for an actor's first (RSA) key. */
export const mainKeyId = (baseUrl: URL, localActor: string): string =>
  new URL("#main-key", new URL(`/actors/${localActor}`, baseUrl)).href;

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
  const actorUri = (localActor: string) => new URL(`/actors/${localActor}`, baseUrl);

  async function enqueue(
    localActor: string,
    activity: Activity,
    recipients: readonly RemoteActor[],
    { carryKey = false }: { carryKey?: boolean } = {},
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
    };
    for (const inbox of inboxesOf(recipients)) {
      const payload: DeliveryPayload = { inbox, ...delivery };
      await jobs.enqueue({
        type: "federationDelivery",
        payload,
        runAt: now,
        expiresAt: new Date(now.getTime() + DELIVERY_HOURS * 60 * 60 * 1000),
      });
    }
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
  };
}

/** One delivery per server: its shared inbox where it has one, else each actor's own. */
function inboxesOf(recipients: readonly RemoteActor[]): string[] {
  return [...new Set(recipients.map((actor) => actor.sharedInbox ?? actor.inbox))];
}
