// What the instance sends to other servers (spec 7 ActivityPub; decision D38), wired once for the
// server and the tests: the publisher that queues activities and the job that delivers them, both
// finding a local actor's keys the same way, and every request through OutboundHttp.
import type { JobOutcome } from "../../../application/jobs.ts";
import type {
  Clock,
  FederationPublisher,
  FediverseProfileRepository,
  IdGenerator,
  JobQueue,
  OutboundHttp,
  ParticipantNoteRepository,
} from "../../../application/ports.ts";
import { actorSigningKeys, type SigningKeyPair } from "../crypto/federation-keys.ts";
import { federationDeliveryHandler } from "./delivery.ts";
import { outboundContextLoader } from "./document-loader.ts";
import { createFederationPublisher } from "./publisher.ts";

export interface FederationOutbound {
  publisher: FederationPublisher;
  /** The `federationDelivery` job. */
  deliver: (payload: unknown) => Promise<JobOutcome>;
}

export function createFederationOutbound({
  jobs,
  clock,
  ids,
  baseUrl,
  instanceKeys,
  profiles,
  notes,
  http,
}: {
  jobs: JobQueue;
  clock: Clock;
  ids: IdGenerator;
  baseUrl: URL;
  instanceKeys: readonly SigningKeyPair[];
  profiles: Pick<FediverseProfileRepository, "findActor">;
  /** Whether a private Note still exists, for its `Create` and `Update` waiting to be tried again. */
  notes: Pick<ParticipantNoteRepository, "find">;
  http: OutboundHttp;
}): FederationOutbound {
  const keysFor = actorSigningKeys(instanceKeys, profiles);
  return {
    publisher: createFederationPublisher({
      jobs,
      clock,
      ids,
      baseUrl,
      keysFor,
      contextLoader: outboundContextLoader(http),
    }),
    deliver: federationDeliveryHandler(
      http,
      keysFor,
      async (guard) => (await notes.find(guard.responseId))?.noteId === guard.noteId,
    ),
  };
}
