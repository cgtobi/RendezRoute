// The instance in the fediverse (spec 7 ActivityPub; decision D36; plan v1.0 step 9a), with Fedify:
// the instance actor and its WebFinger entry, a plan as an `Event` for ActivityPub clients, and the
// inboxes, which verify signatures but act on nothing yet (step 11). The Event is built from the
// plan page's viewer read model (spec 3.6), so it can hold nothing a viewer may not see. Fedify's
// types stay in the adapters (spec 2a).
import { createFederation, type Federation, type KvStore } from "@fedify/fedify";
import { Application, Endpoints, Event, Person, Place, Tombstone } from "@fedify/fedify/vocab";
import { type PlanDeps, viewPlan } from "../../../application/plans.ts";
import type { IdentityRepository, OutboundHttp } from "../../../application/ports.ts";
import {
  planActor,
  posterActor,
  posterActorFor,
  posterActorKeys,
} from "../../../application/fediverse-profile.ts";
import { resolveLanguage, translator } from "../../i18n/i18n.ts";
import {
  outboundContextLoader,
  outboundDocumentLoader,
} from "../../out/federation/document-loader.ts";
import type { PlanViewForViewer } from "../../../application/plan-views.ts";
import { parseKeyPairs, type SigningKeyPair } from "../../out/crypto/federation-keys.ts";

/** The instance actor's identifier in its URI (`/actors/instance`). */
export const INSTANCE_ACTOR = "instance";

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
    const t = translator(
      resolveLanguage({
        cookie: undefined,
        acceptLanguage: ctx.request.headers.get("accept-language") ?? undefined,
      }),
    );
    // Cancelled, said in the name as link previews do; step 10 adds the cancelling Update.
    const name =
      result.view.status === "cancelled"
        ? t("preview.cancelled", { title: result.view.title })
        : result.view.title;
    // The owner's actor once the plan is shared in the fediverse (D35, D37); else the instance's.
    const plan = await planDeps.plans.findById(id);
    const author = plan === undefined ? undefined : await planActor(actorDeps, plan);
    return planEvent(result.view, name, {
      id: ctx.getObjectUri(Event, { id }),
      page: new URL(`/p/${id}`, baseUrl),
      attributedTo: ctx.getActorUri(author ?? INSTANCE_ACTOR),
    });
  });

  // Signatures are checked here; what remote actors may do comes with step 11.
  federation.setInboxListeners("/actors/{identifier}/inbox", "/inbox");
  return federation;
}

/** What every viewer sees of a plan, as an ActivityStreams Event (spec 3.6, 7). */
function planEvent(
  view: PlanViewForViewer,
  name: string,
  uris: { id: URL; page: URL; attributedTo: URL },
): Event {
  const point = view.area.point;
  return new Event({
    id: uris.id,
    // The page has the plan's time zone; ActivityStreams has no property for it.
    name,
    content: view.note === undefined ? null : noteHtml(view.note),
    startTime: Temporal.Instant.from(view.startsAt.toISOString()),
    location: new Place({
      name: view.area.label,
      latitude: point?.lat ?? null,
      longitude: point?.lng ?? null,
    }),
    url: uris.page,
    attribution: uris.attributedTo,
  });
}

/** The note as one paragraph of escaped text, its line breaks kept. */
function noteHtml(note: string): string {
  const escaped = note
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  return `<p>${escaped.split("\n").join("<br>")}</p>`;
}
