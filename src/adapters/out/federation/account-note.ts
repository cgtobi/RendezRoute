// The direct `Note` that tells an account something (spec 7 Optional notification channels,
// decision D47): plain text written in the account's language, addressed to the one person's
// actor and mentioning them, which is how Mastodon knows to show it as a direct message. Never
// public, never to followers, no `cc`. Its address is a random identifier on this instance that
// nothing answers; the Note is stored nowhere, only carried by the encrypted delivery job.
import { Mention, Note } from "@fedify/fedify/vocab";
import { actorUriOf, noteHtml } from "./event.ts";
import { noteUriOf } from "./note.ts";

export function accountNote({
  noteId,
  text,
  handle,
  recipient,
  baseUrl,
  publishedAt,
}: {
  noteId: string;
  text: string;
  /** The recipient as @name@host, for the mention. */
  handle: string;
  recipient: URL;
  baseUrl: URL;
  publishedAt: Date;
}): Note {
  return new Note({
    id: noteUriOf(baseUrl, noteId),
    attribution: actorUriOf(baseUrl, "instance"),
    tos: [recipient],
    tags: [new Mention({ name: handle.startsWith("@") ? handle : `@${handle}`, href: recipient })],
    content: noteHtml(text),
    published: Temporal.Instant.from(publishedAt.toISOString()),
  });
}
