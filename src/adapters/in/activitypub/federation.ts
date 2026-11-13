// The instance in the fediverse (spec 7 ActivityPub; decisions D36, D38, D42; 0.9 steps 9a, 9b,
// 10a, 11a): the instance and poster actors and their WebFinger entries, a plan as an `Event` for
// ActivityPub clients, and the inboxes, which verify signatures and take follows (`Follow` and its
// `Undo`), joins of plans (`Join`, `TentativeAccept` and their `Undo`, or `Leave`) and an actor's
// `Delete` of itself. Followers are counted, never listed. The Event is built from the plan page's
// viewer read model (spec 3.6), so it can hold nothing a viewer may not see. Fedify's types stay
// in the adapters (spec 2a).
import { type Context, createFederation, type Federation, type KvStore } from "@fedify/fedify";
import type { DocumentLoader } from "@fedify/fedify/runtime";
import {
  Application,
  Create,
  Delete,
  Endpoints,
  Event,
  Flag,
  Follow,
  isActor,
  Join,
  Leave,
  Link,
  Note,
  Person,
  TentativeAccept,
  Tombstone,
  Undo,
  Update,
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
  addRemoteContribution,
  deleteRemoteContribution,
  editRemoteContribution,
  isJoinedAnywhere,
} from "../../../application/remote-contributions.ts";
import {
  type FlagObject,
  MAX_FLAG_OBJECTS,
  reportFromFederation,
} from "../../../application/federated-reports.ts";
import {
  forgetRemoteParticipant,
  joinRemote,
  leaveRemote,
} from "../../../application/remote-participants.ts";
import type { FlagLimits, JoinLimits, ReplyLimits } from "../http/rate-limit.ts";
import { replyContent } from "./reply-text.ts";
import { resolveLanguage } from "../../i18n/i18n.ts";
import { planEvent } from "../../out/federation/event.ts";
import { noteIdOf } from "../../out/federation/note.ts";
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
  replyLimits,
  flagLimits,
  reporting,
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
  /** Limits on replies from remote participants (decision D45, spec 3.11). */
  replyLimits: ReplyLimits;
  /** Limits on incoming reports (decision D46, spec 3.11). */
  flagLimits: FlagLimits;
  /** Whether reports are taken: only with admin authentication, as on the web (decision D46). */
  reporting: boolean;
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

  /**
   * A remote participant's reply `Note` (`Create`), or its author's edit (`Update`), as a recap
   * contribution (decisions D44, D45). Only a `Note` of the signer's own, a reply to one of our
   * plans and addressed privately to our actors, is passed on; everything else is ignored
   * silently. Content is reduced to plain text here; the application decides who may write.
   */
  const replyListener =
    (kind: "create" | "update") =>
    async (ctx: Context<void>, activity: Create | Update): Promise<void> => {
      const actorId = activity.actorId;
      if (actorId === null || activity.objectId === null) return;
      // An embedded object is looked at without fetching anything: an `Update` of a profile or
      // an `Event` is not ours to count.
      const embedded = await activity.getObject({
        documentLoader: neverFetches,
        contextLoader: ctx.contextLoader,
        suppressError: true,
      });
      if (embedded !== null && !(embedded instanceof Note)) return;
      // Someone who has joined nothing is not for us: no quota spent, nothing fetched.
      if (!(await isJoinedAnywhere(planDeps, actorId.href))) return;
      // The server's own quota, taken when the reply is plausible (the application asks once it
      // is about to change something), so notes that are not for us cannot lock out its real
      // replies. A Note only named must be fetched first, which costs: that takes it up front.
      // Over the limit the listener fails, so Fedify answers with an error and the server tries
      // again later.
      const take = () => replyLimits.origin.take(actorId.origin).ok;
      const paid = embedded === null;
      if (paid && !take()) throw new RepliesLimited();
      const note = embedded ?? (await activity.getObject(ctx));
      // The signer's own Note: on its own server, and not attributed to anyone else.
      if (!(note instanceof Note) || note.id === null || note.id.origin !== actorId.origin) return;
      const authors = note.attributionIds;
      if (authors.length > 1 || (authors[0] !== undefined && authors[0].href !== actorId.href)) {
        return;
      }
      // A reply to exactly one thing: one of our plans' Events, or one of our Notes.
      const [replyTarget, ...others] = note.replyTargetIds;
      if (replyTarget === undefined || others.length > 0) return;
      const planId = planOf(ctx, replyTarget);
      const ourNoteId = noteIdOf(baseUrl, replyTarget);
      const target =
        planId !== undefined ? { planId } : ourNoteId !== undefined ? { ourNoteId } : undefined;
      if (target === undefined) return;
      const addressedTo = privateAddressees(ctx, note, activity);
      if (addressedTo === undefined) return;
      const links: string[] = [];
      let looked = 0;
      for await (const attachment of note.getAttachments({
        documentLoader: neverFetches,
        contextLoader: ctx.contextLoader,
        suppressError: true,
      })) {
        looked += 1;
        if (attachment instanceof Link && attachment.href !== null) {
          links.push(attachment.href.href);
          // The first web address is the one that counts: no need to look further.
          if (/^https?:$/.test(attachment.href.protocol)) break;
        }
        if (looked >= MAX_ATTACHMENTS) break;
      }
      const content = replyContent(note.content === null ? "" : note.content.toString(), links);
      if (content === undefined) return;
      const request = {
        ...target,
        actorId: actorId.href,
        noteId: note.id.href,
        addressedTo,
        body: content.body,
        linkUrl: content.link ?? "",
        admit: () => paid || take(),
      };
      const result = await (kind === "create"
        ? addRemoteContribution(planDeps, request)
        : editRemoteContribution(planDeps, request));
      if (result === "limited") throw new RepliesLimited();
    };

  /**
   * A remote `Flag` as a report (decision D46). The objects it names are looked up without
   * fetching anything; what is not ours is passed over. Nothing about the reporter is kept: its
   * server is the key of an in-memory quota only. Over a quota the listener fails, so Fedify
   * answers with an error and does not note the activity, and the server sends it again later.
   */
  const flagListener = async (ctx: Context<void>, flag: Flag): Promise<void> => {
    if (!reporting || flag.actorId === null) return;
    const origin = flag.actorId.origin;
    const objects: FlagObject[] = [];
    for (const objectId of flag.objectIds.slice(0, MAX_FLAG_OBJECTS)) {
      const planId = planOf(ctx, objectId);
      const noteId = noteIdOf(baseUrl, objectId);
      if (planId !== undefined) objects.push({ kind: "plan", planId });
      else if (noteId !== undefined) objects.push({ kind: "note", noteId });
    }
    if (objects.length === 0) return;
    const html = flag.content === null ? "" : flag.content.toString();
    const result = await reportFromFederation(planDeps, {
      objects,
      reporterOrigin: origin,
      text: flagText(html),
      // Both must have room before either is spent: a refusal takes nothing of the other.
      admit: (planId) => {
        if (!flagLimits.origin.check(origin).ok || !flagLimits.plan.check(planId).ok) return false;
        flagLimits.origin.take(origin);
        flagLimits.plan.take(planId);
        return true;
      },
    });
    if (result === "limited") throw new FlagsLimited();
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
    .on(Flag, flagListener)
    .on(Create, replyListener("create"))
    .on(Update, replyListener("update"))
    .on(Delete, async (_ctx, deleted) => {
      // An actor deleting itself: it follows nobody and takes part in nothing any more (spec 3.7).
      const self = deletedSelf(deleted);
      if (self !== undefined) {
        await forgetActor(self);
        return;
      }
      // An author deleting a reply of theirs: only their own Notes are found (decision D44).
      if (deleted.actorId !== null && deleted.objectId !== null) {
        await deleteRemoteContribution(planDeps, {
          actorId: deleted.actorId.href,
          noteId: deleted.objectId.href,
        });
      }
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

/** No more attachments than this are looked at: only one web link is ever used. */
const MAX_ATTACHMENTS = 20;

/** A server joined more than its limit allows: to be tried again later. */
class JoinsLimited extends Error {
  constructor() {
    super("too many joins from this server");
  }
}

/** A server sent more replies than its limit allows: to be tried again later. */
class RepliesLimited extends Error {
  constructor() {
    super("too many replies from this server");
  }
}

/** A server or plan got more reports than its limit allows: to be tried again later. */
class FlagsLimited extends Error {
  constructor() {
    super("too many reports");
  }
}

/** Looks at what an activity embeds, never at what it only names. */
const neverFetches: DocumentLoader = () => Promise.reject(new Error("not fetched"));

/**
 * The local actors a reply is addressed to, by identifier, on the Note and on its activity alike;
 * undefined unless it is addressed to nothing but our actors: anything public, a followers
 * collection, another person or server, or no one at all is not private.
 */
function privateAddressees(
  ctx: Context<void>,
  note: Note,
  activity: Create | Update,
): string[] | undefined {
  const addressed = [note, activity].flatMap((object) => [
    ...object.toIds,
    ...object.ccIds,
    ...object.btoIds,
    ...object.bccIds,
    ...object.audienceIds,
  ]);
  const identifiers: string[] = [];
  for (const address of addressed) {
    const parsed = ctx.parseUri(address);
    if (parsed?.type !== "actor") return undefined;
    identifiers.push(parsed.identifier);
  }
  return identifiers.length === 0 ? undefined : [...new Set(identifiers)];
}

/** A `Flag`'s content as plain text; a link in it is kept, written out after the text. */
function flagText(html: string): string {
  const content = replyContent(html.slice(0, MAX_FLAG_HTML), []);
  if (content === undefined) return "";
  return content.link === undefined ? content.body : `${content.body}\n${content.link}`.trim();
}

/** Content beyond this is not worked through: a report holds 1,000 characters. */
const MAX_FLAG_HTML = 20_000;

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
