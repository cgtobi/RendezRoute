// The instance in the fediverse (spec 7 ActivityPub; decisions D36, D38, D42; 0.9 steps 9a, 9b,
// 10a, 11a): the instance and poster actors and their WebFinger entries, a plan as an `Event` for
// ActivityPub clients, and the inboxes, which verify signatures and take follows (`Follow` and its
// `Undo`), joins of plans (`Join`, `TentativeAccept` and their `Undo`, or `Leave`) and an actor's
// `Delete` of itself. Followers are counted, never listed. The Event is built from the plan page's
// viewer read model (spec 3.6), so it can hold nothing a viewer may not see. Fedify's types stay
// in the adapters (spec 2a).
import { type Context, createFederation, type Federation, type KvStore } from "@fedify/fedify";
import {
  Application,
  Delete,
  Endpoints,
  Event,
  Follow,
  isActor,
  Join,
  Leave,
  Person,
  TentativeAccept,
  Tombstone,
  Undo,
} from "@fedify/fedify/vocab";
import { type PlanDeps, viewPlan } from "../../../application/plans.ts";
import type { IdentityRepository, LookupHasher, OutboundHttp } from "../../../application/ports.ts";
import {
  planActor,
  posterActor,
  posterActorFor,
  posterActorKeys,
} from "../../../application/fediverse-profile.ts";
import {
  followActor,
  followerCount,
  forgetRemoteActor,
  INSTANCE_ACTOR,
  isFollowable,
  unfollowActor,
} from "../../../application/following.ts";
import {
  forgetRemoteParticipant,
  joinRemote,
  leaveRemote,
} from "../../../application/remote-participants.ts";
import type { JoinLimits } from "../http/rate-limit.ts";
import { resolveLanguage } from "../../i18n/i18n.ts";
import { planEvent } from "../../out/federation/event.ts";
import {
  outboundContextLoader,
  outboundDocumentLoader,
} from "../../out/federation/document-loader.ts";
import { parseKeyPairs, type SigningKeyPair } from "../../out/crypto/federation-keys.ts";

export interface FederationSettings {
  baseUrl: URL;
  instanceName: string;
}

/** How long a remote server's public key is kept for checking its signatures (privacy notice). */
export const PUBLIC_KEY_DAYS = 30;

export function createInstanceFederation({
  settings,
  kv,
  http,
  instanceKeys,
  planDeps,
  identities,
  hasher,
  joinLimits,
}: {
  settings: FederationSettings;
  kv: KvStore;
  /** Every remote fetch, with its SSRF rules (spec 3.11). */
  http: OutboundHttp;
  instanceKeys: readonly SigningKeyPair[];
  planDeps: PlanDeps;
  /** The display names of poster actors. */
  identities: Pick<IdentityRepository, "findById">;
  /** Keys the processed-activity records, so no address is stored for them. */
  hasher: LookupHasher;
  /** Limits on remote joins (decision D42, spec 3.11). */
  joinLimits: JoinLimits;
}): Federation<void> {
  const actorDeps = { ...planDeps, identities };
  const { baseUrl } = settings;
  // The instance's own handle is its host, as Mastodon names its instance actor.
  const handle = baseUrl.hostname;
  // No queue yet: nothing is sent or queued before step 10, and the inbox acts on nothing.
  const federation = createFederation<void>({
    kv,
    origin: baseUrl.origin,
    documentLoaderFactory: () => outboundDocumentLoader(http),
    contextLoaderFactory: () => outboundContextLoader(http),
    publicKeyTtl: { days: PUBLIC_KEY_DAYS },
  });

  federation
    .setActorDispatcher("/actors/{identifier}", async (ctx, identifier) => {
      if (identifier !== INSTANCE_ACTOR) {
        // A poster's actor (decision D36), or gone for good once retired (D37).
        const actor = await posterActor(actorDeps, identifier);
        if (actor === undefined) return null;
        if (actor.kind === "retired") {
          return new Tombstone({
            id: ctx.getActorUri(identifier),
            deleted: Temporal.Instant.from(actor.retiredAt.toISOString()),
          });
        }
        const keys = await ctx.getActorKeyPairs(identifier);
        return new Person({
          id: ctx.getActorUri(identifier),
          preferredUsername: actor.handle,
          name: actor.displayName ?? actor.handle,
          url: new URL(`/@${actor.handle}`, baseUrl),
          inbox: ctx.getInboxUri(identifier),
          followers: ctx.getFollowersUri(identifier),
          endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
          publicKey: keys[0]?.cryptographicKey ?? null,
          assertionMethods: keys.map((key) => key.multikey),
          discoverable: true,
          manuallyApprovesFollowers: false,
        });
      }
      const keys = await ctx.getActorKeyPairs(identifier);
      return new Application({
        id: ctx.getActorUri(identifier),
        preferredUsername: handle,
        name: settings.instanceName,
        url: new URL("/", baseUrl),
        inbox: ctx.getInboxUri(identifier),
        followers: ctx.getFollowersUri(identifier),
        endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
        publicKey: keys[0]?.cryptographicKey ?? null,
        assertionMethods: keys.map((key) => key.multikey),
      });
    })
    .setKeyPairsDispatcher(async (_ctx, identifier) => {
      if (identifier === INSTANCE_ACTOR) return [...instanceKeys];
      const keys = await posterActorKeys(planDeps, identifier);
      return keys === undefined ? [] : parseKeyPairs(keys);
    })
    .mapHandle(async (_ctx, username) =>
      username.toLowerCase() === handle
        ? INSTANCE_ACTOR
        : ((await posterActorFor(actorDeps, username)) ?? null),
    );

  federation.setObjectDispatcher(Event, "/p/{id}", async (ctx, { id }) => {
    const result = await viewPlan(planDeps, { planId: id, deviceToken: undefined });
    if (result.kind !== "viewer") return null;
    // In the requester's language, as the page would be (decision D15).
    const language = resolveLanguage({
      cookie: undefined,
      acceptLanguage: ctx.request.headers.get("accept-language") ?? undefined,
    });
    // The owner's actor while its profile shares the plan (D35, D37); else, also once withdrawn
    // from the fediverse (D39), the instance's.
    const sent = await planDeps.posterActors?.publications.find(id);
    const plan = await planDeps.plans.findById(id);
    const author =
      plan === undefined || sent?.kind === "withdrawn"
        ? undefined
        : await planActor(planDeps, plan);
    // Addressed as it was sent, so a server fetching it shows it to the same people (D38).
    return planEvent(result.view, language, {
      baseUrl,
      localActor: author ?? INSTANCE_ACTOR,
      audience: sent?.kind === "published" ? sent.audience : undefined,
    });
  });

  // How many follow an actor, never who (decision D38).
  federation
    .setFollowersDispatcher("/actors/{identifier}/followers", async (_ctx, identifier) =>
      (await isFollowable(planDeps, identifier)) ? { items: [] } : null,
    )
    .setCounter((_ctx, identifier) => followerCount(planDeps, identifier));

  /** The plan an activity's object is, by its address; undefined for anything else. */
  const planOf = (ctx: Context<void>, objectId: URL | null): string | undefined => {
    const parsed = objectId === null ? null : ctx.parseUri(objectId);
    return parsed?.type === "object" && parsed.class === Event ? parsed.values.id : undefined;
  };

  /** A remote actor's `Join` or `TentativeAccept` of a plan (decision D42). */
  const joinListener =
    (kind: "join" | "tentative") =>
    async (ctx: Context<void>, join: Join | TentativeAccept): Promise<void> => {
      const planId = planOf(ctx, join.objectId);
      if (join.id === null || planId === undefined) return;
      if (join.actorId === null) return;
      // A server may join as often as the web may respond. Beyond that nothing is done, not even
      // fetching the actor, and the listener fails: Fedify answers with an error and does not
      // note the activity as processed, so the server sends it again later. Fedify has checked
      // that the signer is this actor, so its server cannot be a false one.
      if (!joinLimits.origin.take(join.actorId.origin).ok) throw new JoinsLimited();
      const remote = await join.getActor(ctx);
      if (remote === null || !isActor(remote) || remote.inboxId === null) return;
      // The actor document must be the signer's own, or Undo and Delete could never find it.
      if (remote.id === null || remote.id.href !== join.actorId.href) return;
      const actor = remote.id.href;
      await joinRemote(planDeps, {
        planId,
        // Taken only when a notice is due; the plan's own cap holds against many servers.
        mayNotifyHost: (answer) => {
          // Both must have room before either is spent: no notice, no token.
          const actorKey = `${planId} ${actor} ${answer}`;
          if (
            !joinLimits.notifyActor.check(actorKey).ok ||
            !joinLimits.notifyPlan.check(planId).ok
          ) {
            return false;
          }
          joinLimits.notifyActor.take(actorKey);
          joinLimits.notifyPlan.take(planId);
          return true;
        },
        join: { id: join.id.href, kind },
        actor: {
          id: remote.id.href,
          inbox: remote.inboxId.href,
          sharedInbox: remote.endpoints?.sharedInbox?.href,
        },
        username: remote.preferredUsername?.toString(),
        name: remote.name?.toString(),
      });
    };

  const forgetActor = async (actor: URL) => {
    await forgetRemoteActor(planDeps, actor.href);
    await forgetRemoteParticipant(planDeps, actor.href);
  };

  // Fedify checks every signature, and that the signer is the activity's actor, before these run.
  federation
    .setInboxListeners("/actors/{identifier}/inbox", "/inbox")
    .on(Follow, async (ctx, follow) => {
      const followed = follow.objectId === null ? null : ctx.parseUri(follow.objectId);
      if (follow.id === null || followed?.type !== "actor") return;
      const follower = await follow.getActor(ctx);
      if (follower === null || !isActor(follower) || follower.inboxId === null) return;
      // The actor document must be the signer's own, or Undo and Delete could never find it.
      if (follower.id === null || follower.id.href !== follow.actorId?.href) return;
      await followActor(planDeps, {
        localActor: followed.identifier,
        followId: follow.id.href,
        follower: {
          id: follower.id.href,
          inbox: follower.inboxId.href,
          sharedInbox: follower.endpoints?.sharedInbox?.href,
        },
      });
    })
    .on(Join, joinListener("join"))
    .on(TentativeAccept, joinListener("tentative"))
    .on(Leave, async (ctx, leave) => {
      // Mobilizon leaves an event with `Leave`; the signer is the actor, so it is its own leave.
      const planId = planOf(ctx, leave.objectId);
      if (planId === undefined || leave.actorId === null) return;
      await leaveRemote(planDeps, { planId, actorId: leave.actorId.href });
    })
    .on(Undo, async (ctx, undo) => {
      const follow = await undo.getObject(ctx);
      if (undo.actorId === null) return;
      if (follow instanceof Join || follow instanceof TentativeAccept) {
        // Only one's own join can be undone: Fedify trusts an embedded activity of the signer's
        // server, so its actor is compared here.
        const planId = planOf(ctx, follow.objectId);
        if (planId === undefined || follow.actorId?.href !== undo.actorId.href) return;
        // Naming the activity undone, which a later answer of the actor may have replaced.
        if (follow.id === null) return;
        await leaveRemote(planDeps, {
          planId,
          actorId: undo.actorId.href,
          joinId: follow.id.href,
        });
        return;
      }
      if (!(follow instanceof Follow)) return;
      // Only one's own follow can be undone.
      if (follow.actorId?.href !== undo.actorId.href || follow.objectId === null) return;
      const followed = ctx.parseUri(follow.objectId);
      if (followed?.type !== "actor") return;
      await unfollowActor(planDeps, {
        localActor: followed.identifier,
        remoteActorId: undo.actorId.href,
      });
    })
    .on(Delete, async (_ctx, deleted) => {
      // An actor deleting itself: it follows nobody and takes part in nothing any more (spec 3.7).
      const self = deletedSelf(deleted);
      if (self !== undefined) await forgetActor(self);
    })
    // Processed activities are noted under a keyed hash, so no actor or activity address is stored.
    .withIdempotency((ctx, activity) =>
      activity.id === null
        ? null
        : hasher.hash(`fediverse-activity:${activity.id.href}\n${ctx.recipient ?? ""}`),
    )
    .onUnverifiedActivity(async (_ctx, activity) => {
      // An account deleted on its server can no longer sign: its key is gone too. Its Delete of
      // itself is believed once its server, asked by us, says the account is gone (spec 3.7).
      const self = activity instanceof Delete ? deletedSelf(activity) : undefined;
      if (self === undefined || !(await actorGone(http, self))) return;
      await forgetActor(self);
      return new Response(null, { status: 202 });
    });
  return federation;
}

/** A server joined more than its limit allows: to be tried again later. */
class JoinsLimited extends Error {
  constructor() {
    super("too many joins from this server");
  }
}

/** The actor of a `Delete` of itself; undefined for any other `Delete`. */
function deletedSelf(deleted: Delete): URL | undefined {
  return deleted.actorId !== null && deleted.objectId?.href === deleted.actorId.href
    ? deleted.actorId
    : undefined;
}

/** Whether the actor's own server answers that it is gone (404 or 410). */
async function actorGone(http: OutboundHttp, actor: URL): Promise<boolean> {
  try {
    const response = await http.get(actor, {
      headers: { accept: "application/activity+json" },
      maxBytes: 64 * 1024,
      timeoutMs: 10_000,
    });
    return response.status === 404 || response.status === 410;
  } catch {
    return false;
  }
}
