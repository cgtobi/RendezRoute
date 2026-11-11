// The instance in the fediverse (spec 7 ActivityPub; decisions D36, D38; 0.9 steps 9a, 9b, 10a),
// with Fedify: the instance and poster actors and their WebFinger entries, a plan as an `Event` for
// ActivityPub clients, and the inboxes, which verify signatures and take follows: `Follow` and its
// `Undo`, and an actor's `Delete` of itself; joining plans comes with step 11. Followers are
// counted, never listed. The Event is built from the plan page's viewer read model (spec 3.6), so
// it can hold nothing a viewer may not see. Fedify's types stay in the adapters (spec 2a).
import { createFederation, type Federation, type KvStore } from "@fedify/fedify";
import {
  Application,
  Delete,
  Endpoints,
  Event,
  Follow,
  isActor,
  Person,
  Tombstone,
  Undo,
} from "@fedify/fedify/vocab";
import { type PlanDeps, viewPlan } from "../../../application/plans.ts";
import type { IdentityRepository, OutboundHttp } from "../../../application/ports.ts";
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
}: {
  settings: FederationSettings;
  kv: KvStore;
  /** Every remote fetch, with its SSRF rules (spec 3.11). */
  http: OutboundHttp;
  instanceKeys: readonly SigningKeyPair[];
  planDeps: PlanDeps;
  /** The display names of poster actors. */
  identities: Pick<IdentityRepository, "findById">;
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
    .on(Undo, async (ctx, undo) => {
      const follow = await undo.getObject(ctx);
      if (!(follow instanceof Follow) || undo.actorId === null) return;
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
      // An actor deleting itself; what else may be deleted comes with step 11.
      const self = deletedSelf(deleted);
      if (self !== undefined) await forgetRemoteActor(planDeps, self.href);
    })
    .onUnverifiedActivity(async (_ctx, activity) => {
      // An account deleted on its server can no longer sign: its key is gone too. Its Delete of
      // itself is believed once its server, asked by us, says the account is gone (spec 3.7).
      const self = activity instanceof Delete ? deletedSelf(activity) : undefined;
      if (self === undefined || !(await actorGone(http, self))) return;
      await forgetRemoteActor(planDeps, self.href);
      return new Response(null, { status: 202 });
    });
  return federation;
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
