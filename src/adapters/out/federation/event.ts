// A plan as an ActivityStreams `Event` (spec 3.6, 7; decisions D38, D39), for the object at its
// address and for what is sent to followers: built only from the fields every viewer sees, the
// area as its public point, never the exact start. Cancelled plans say so in the name, as link
// previews do. Addressed to the audience it was sent to, where it was.
import { Event, PUBLIC_COLLECTION, Place } from "@fedify/fedify/vocab";
import type { Audience, PlanEventView } from "../../../application/ports.ts";
import { DEFAULT_LANGUAGE, isLanguage, translator } from "../../i18n/i18n.ts";

export interface EventAddress {
  baseUrl: URL;
  /** The local actor it is attributed to. */
  localActor: string;
  /** Who it was sent to; undefined for an Event no one was sent. */
  audience?: Audience | undefined;
}

/** A local actor's address, as Fedify serves it (federation.ts: `/actors/{identifier}`). */
export const actorUriOf = (baseUrl: URL, localActor: string): URL =>
  new URL(`/actors/${localActor}`, baseUrl);

/** Public: to everyone, copied to the followers; followers: to them only (spec 7 Addressing). */
export function addressing(actor: URL, audience: Audience | undefined): { tos: URL[]; ccs: URL[] } {
  const followers = new URL(`${actor.href}/followers`);
  if (audience === "public") return { tos: [PUBLIC_COLLECTION], ccs: [followers] };
  return audience === "followers" ? { tos: [followers], ccs: [] } : { tos: [], ccs: [] };
}

/** The address of a plan: its page, and its `Event` for ActivityPub clients. */
export const planUriOf = (baseUrl: URL, planId: string): URL => new URL(`/p/${planId}`, baseUrl);

export function planEvent(view: PlanEventView, language: string, address: EventAddress): Event {
  const point = view.area.point;
  const page = planUriOf(address.baseUrl, view.id);
  const actor = actorUriOf(address.baseUrl, address.localActor);
  return new Event({
    id: page,
    // The page has the plan's time zone; ActivityStreams has no property for it.
    name:
      view.status === "cancelled"
        ? translator(isLanguage(language) ? language : DEFAULT_LANGUAGE)("preview.cancelled", {
            title: view.title,
          })
        : view.title,
    content: view.note === undefined ? null : noteHtml(view.note),
    startTime: Temporal.Instant.from(view.startsAt.toISOString()),
    location: new Place({
      name: view.area.label,
      latitude: point?.lat ?? null,
      longitude: point?.lng ?? null,
    }),
    url: page,
    attribution: actor,
    ...addressing(actor, address.audience),
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
