// The direct `Note` that carries a recap contribution to a remote participant who joined (spec 6
// recap, 7 ActivityPub; decisions D44, D45): plain text in the plan's language with the author's
// name as web participants see it, the comment, the link as text, the plan page's link and the
// notice that their server may keep copies, `inReplyTo` the plan's `Event`, addressed to the one
// recipient: never public, never copied. Characters that reorder text are removed from the name
// and the comment. Nothing of the exact start or the route, and no
// third-party address but the contribution's own link.
import { Note } from "@fedify/fedify/vocab";
import { stripBidiControls } from "../../../domain/text.ts";
import type { ContributionNoteFacts } from "../../../application/ports.ts";
import { DEFAULT_LANGUAGE, isLanguage, translator } from "../../i18n/i18n.ts";
import { actorUriOf, noteHtml, planUriOf } from "./event.ts";
import { noteUriOf } from "./note.ts";

/** The Note's text, one paragraph per fact, in the plan's language. */
export function contributionNoteText(facts: ContributionNoteFacts, baseUrl: URL): string {
  const t = translator(isLanguage(facts.language) ? facts.language : DEFAULT_LANGUAGE);
  return [
    t("recapNote.intro", { author: stripBidiControls(facts.authorName) }),
    ...(facts.body === undefined ? [] : [stripBidiControls(facts.body)]),
    ...(facts.linkUrl === undefined ? [] : [t("recapNote.link", { link: facts.linkUrl })]),
    t("recapNote.plan", { link: planUriOf(baseUrl, facts.planId).href }),
    t("recapNote.copies"),
  ].join("\n");
}

/** The Note for one recipient, addressed to them alone. */
export function contributionNote(
  facts: ContributionNoteFacts,
  { baseUrl, recipient }: { baseUrl: URL; recipient: URL },
): Note {
  return new Note({
    id: noteUriOf(baseUrl, facts.noteId),
    attribution: actorUriOf(baseUrl, facts.localActor),
    replyTarget: planUriOf(baseUrl, facts.planId),
    tos: [recipient],
    content: noteHtml(contributionNoteText(facts, baseUrl)),
    published: Temporal.Instant.from(facts.publishedAt.toISOString()),
    updated:
      facts.updatedAt === undefined ? null : Temporal.Instant.from(facts.updatedAt.toISOString()),
  });
}
