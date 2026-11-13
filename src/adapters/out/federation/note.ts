// The private direct `Note` to a remote participant who joined (spec 7 ActivityPub; decision D43):
// the exact start and start time as plain text in the plan's language, the plan page's link and the
// notice that their server may keep copies; the route is not in the text but a GPX `Document` at
// a secret link on this instance. Addressed to the one recipient: never public, never copied. No
// third-party map link is ever written.
import { Document, Note } from "@fedify/fedify/vocab";
import type { ParticipantNoteFacts } from "../../../application/ports.ts";
import { formatDay, formatTime } from "../../i18n/dates.ts";
import { DEFAULT_LANGUAGE, isLanguage, translator } from "../../i18n/i18n.ts";
import { actorUriOf, noteHtml, planUriOf } from "./event.ts";

const translate = (language: string) =>
  translator(isLanguage(language) ? language : DEFAULT_LANGUAGE);

/** A Note's address: an identifier only, which nothing answers (it tells nobody anything). */
export const noteUriOf = (baseUrl: URL, noteId: string): URL =>
  new URL(`/notes/${noteId}`, baseUrl);

/** The secret link of a Note's GPX; the token is the only thing that opens it. */
export const routeLinkOf = (baseUrl: URL, token: string): URL =>
  new URL(`/federation/notes/${token}/route.gpx`, baseUrl);

/** "Your server may keep copies": in the Note, and in the summary of the `Accept`. */
export const copiesNotice = (language: string): string => translate(language)("note.copies");

/** The Note's text, one line per fact, in the plan's language. */
export function participantNoteText(facts: ParticipantNoteFacts, baseUrl: URL): string {
  const t = translate(facts.language);
  const { exactStart } = facts;
  const when = `${formatDay(facts.startsAt, facts.timeZone, facts.language)}, ${formatTime(facts.startsAt, facts.timeZone, facts.language)} (${t("plan.timeZone", { zone: facts.timeZone })})`;
  return [
    facts.title,
    t("note.start", { when }),
    ...(exactStart?.description === undefined
      ? []
      : [t("note.place", { place: exactStart.description })]),
    ...(exactStart?.point === undefined
      ? []
      : [
          t("note.coordinates", {
            lat: String(exactStart.point.lat),
            lng: String(exactStart.point.lng),
          }),
        ]),
    ...(facts.routeToken === undefined ? [] : [t("note.route")]),
    t("note.plan", { link: planUriOf(baseUrl, facts.planId).href }),
    t("note.copies"),
  ].join("\n");
}

/** The Note for one recipient, addressed to them alone. */
export function participantNote(
  facts: ParticipantNoteFacts,
  { baseUrl, recipient }: { baseUrl: URL; recipient: URL },
): Note {
  return new Note({
    id: noteUriOf(baseUrl, facts.noteId),
    attribution: actorUriOf(baseUrl, facts.localActor),
    tos: [recipient],
    content: noteHtml(participantNoteText(facts, baseUrl)),
    published: Temporal.Instant.from(facts.publishedAt.toISOString()),
    updated:
      facts.updatedAt === undefined ? null : Temporal.Instant.from(facts.updatedAt.toISOString()),
    attachments:
      facts.routeToken === undefined
        ? []
        : [
            new Document({
              mediaType: "application/gpx+xml",
              name: "route.gpx",
              url: routeLinkOf(baseUrl, facts.routeToken),
            }),
          ],
  });
}
