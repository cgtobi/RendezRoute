// The direct Note that carries a recap contribution (decisions D44, I31): plain text in the plan's
// language with the author's name, the comment, the link, the plan page and the copies notice;
// `inReplyTo` the plan's Event; addressed to the recipient alone; HTML-escaped; no exact start,
// no route, no third-party address but the contribution's own link.
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../../src/adapters/i18n/i18n.ts";
import {
  contributionNote,
  contributionNoteText,
} from "../../../../src/adapters/out/federation/contribution-note.ts";
import type { ContributionNoteFacts } from "../../../../src/application/ports.ts";

const BASE = new URL("https://runs.example.org");
const facts = (overrides: Partial<ContributionNoteFacts> = {}): ContributionNoteFacts => ({
  noteId: "note-abc",
  planId: "plan-xyz",
  contributionId: "contribution-1",
  responseId: "response-1",
  localActor: "instance",
  language: "en",
  authorName: "Wanda",
  body: "Lovely loop, thanks!",
  linkUrl: "https://photos.example/loop-2026",
  publishedAt: new Date("2026-06-07T12:00:00Z"),
  updatedAt: undefined,
  ...overrides,
});

describe("the contribution Note's text", () => {
  it.each(["en", "de", "fr"] as const)(
    "is in the plan's language (%s) and holds everything",
    (language) => {
      const t = translator(language);
      const text = contributionNoteText(facts({ language }), BASE);
      expect(text).toContain(t("recapNote.intro", { author: "Wanda" }));
      expect(text).toContain("Lovely loop, thanks!");
      expect(text).toContain(t("recapNote.link", { link: "https://photos.example/loop-2026" }));
      expect(text).toContain(t("recapNote.plan", { link: "https://runs.example.org/p/plan-xyz" }));
      expect(text).toContain(t("recapNote.copies"));
    },
  );

  it("differs between languages, and keeps the French space before a colon", () => {
    const texts = (["en", "de", "fr"] as const).map((language) =>
      contributionNoteText(facts({ language }), BASE),
    );
    expect(new Set(texts).size).toBe(3);
    expect(texts[2]).toContain("Wanda a écrit dans le récapitulatif :");
  });

  it("takes no part of the author's name or the comment for a placeholder", () => {
    const text = contributionNoteText(
      facts({ authorName: "{link} {author} {name}", body: "{link} and {author}" }),
      BASE,
    );
    expect(text).toContain("{link} {author} {name} wrote in the recap:");
    expect(text).toContain("{link} and {author}");
    // The plan page's address is written once, in its own line, and no placeholder was filled.
    expect(text.split("https://runs.example.org/p/plan-xyz")).toHaveLength(2);
    expect(text.split("https://photos.example/loop-2026")).toHaveLength(2);
  });

  it("removes characters that reorder text from the author's name and the comment", () => {
    const bidi = "\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069\u200e\u200f\u061c";
    const text = contributionNoteText(
      facts({ authorName: `Wa${bidi}nda`, body: `Lovely ${bidi}loop` }),
      BASE,
    );
    expect(text).toContain("Wanda wrote in the recap:");
    expect(text).toContain("Lovely loop");
    expect(text).not.toMatch(/[\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/u);
  });

  it("leaves out the comment or the link the contribution does not have", () => {
    const t = translator("en");
    const onlyLink = contributionNoteText(facts({ body: undefined }), BASE);
    expect(onlyLink).toContain("https://photos.example/loop-2026");
    expect(onlyLink).not.toContain("Lovely loop");
    const onlyBody = contributionNoteText(facts({ linkUrl: undefined }), BASE);
    expect(onlyBody).toContain("Lovely loop");
    expect(onlyBody).not.toContain(t("recapNote.link", { link: "" }).slice(0, 5));
  });

  it("names only our plan page and the contribution's own link: no map, no exact start, no route", () => {
    const text = contributionNoteText(facts(), BASE);
    expect(text.match(/https?:\/\/\S+/g)).toEqual([
      "https://photos.example/loop-2026",
      "https://runs.example.org/p/plan-xyz",
    ]);
    expect(text).not.toMatch(/gpx|lat|coordinates|meeting point/i);
  });
});

describe("the contribution Note", () => {
  const recipient = new URL("https://social.example/users/ben");
  const json = async (note: ReturnType<typeof contributionNote>) =>
    (await note.toJsonLd({ format: "compact" })) as Record<string, unknown>;

  it("is a reply to the plan's Event, addressed to the recipient alone, from the local actor", async () => {
    const compact = await json(contributionNote(facts(), { baseUrl: BASE, recipient }));
    expect(compact).toMatchObject({
      type: "Note",
      id: "https://runs.example.org/notes/note-abc",
      attributedTo: "https://runs.example.org/actors/instance",
      inReplyTo: "https://runs.example.org/p/plan-xyz",
      to: "https://social.example/users/ben",
    });
    for (const key of ["cc", "bto", "bcc", "audience", "attachment", "url"]) {
      expect(compact).not.toHaveProperty(key);
    }
  });

  it("escapes what people wrote, as HTML", async () => {
    const compact = await json(
      contributionNote(facts({ authorName: "<i>W</i>", body: 'a <script>"x"</script> & b' }), {
        baseUrl: BASE,
        recipient,
      }),
    );
    const content = String(compact.content);
    expect(content).toContain("&lt;i&gt;W&lt;/i&gt;");
    expect(content).toContain("a &lt;script&gt;&quot;x&quot;&lt;/script&gt; &amp; b");
    expect(content).not.toContain("<script>");
    expect(content).not.toContain("<i>");
  });

  it("says when it was published, and when last updated", async () => {
    const created = await json(contributionNote(facts(), { baseUrl: BASE, recipient }));
    expect(created.published).toBe("2026-06-07T12:00:00Z");
    expect(created).not.toHaveProperty("updated");
    const updated = await json(
      contributionNote(facts({ updatedAt: new Date("2026-06-08T09:30:00Z") }), {
        baseUrl: BASE,
        recipient,
      }),
    );
    expect(updated).toMatchObject({
      published: "2026-06-07T12:00:00Z",
      updated: "2026-06-08T09:30:00Z",
    });
  });
});
