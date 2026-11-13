// The private Note to a remote participant (decision D43, I31): plain text in the plan's language
// with the exact start, the time with its zone, the plan's link and the copies notice; the route
// as a GPX `Document` at the secret link, never as a link in the text; no third-party addresses.
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../../src/adapters/i18n/i18n.ts";
import {
  copiesNotice,
  noteUriOf,
  participantNote,
  participantNoteText,
  routeLinkOf,
} from "../../../../src/adapters/out/federation/note.ts";
import type { ParticipantNoteFacts } from "../../../../src/application/ports.ts";

const BASE = new URL("https://runs.example.org");
const facts = (overrides: Partial<ParticipantNoteFacts> = {}): ParticipantNoteFacts => ({
  noteId: "note-abc",
  planId: "plan-xyz",
  responseId: "response-1",
  localActor: "instance",
  language: "en",
  title: "Weir loop",
  startsAt: new Date("2026-06-07T05:30:00Z"),
  timeZone: "Europe/Berlin",
  exactStart: {
    description: "Kiosk by the river weir",
    point: { lat: 48.20417, lng: 11.70123 },
  },
  routeToken: undefined,
  publishedAt: new Date("2026-06-01T08:00:00Z"),
  updatedAt: undefined,
  ...overrides,
});

describe("the Note's text", () => {
  it.each(["en", "de", "fr"] as const)(
    "is in the plan's language (%s) and holds everything",
    (language) => {
      const t = translator(language);
      const text = participantNoteText(facts({ language }), BASE);
      expect(text).toContain("Weir loop");
      expect(text).toContain(t("note.place", { place: "Kiosk by the river weir" }));
      expect(text).toContain(t("note.coordinates", { lat: "48.20417", lng: "11.70123" }));
      expect(text).toContain("07:30");
      expect(text).toContain("2026");
      expect(text).toContain(t("plan.timeZone", { zone: "Europe/Berlin" }));
      expect(text).toContain(t("note.plan", { link: "https://runs.example.org/p/plan-xyz" }));
      expect(text).toContain(copiesNotice(language));
      expect(copiesNotice(language)).toBe(t("note.copies"));
    },
  );

  it("differs between languages", () => {
    const texts = (["en", "de", "fr"] as const).map((language) =>
      participantNoteText(facts({ language }), BASE),
    );
    expect(new Set(texts).size).toBe(3);
  });

  it("names only our own plan page: no map or other third-party link, and not the route link", () => {
    const text = participantNoteText(facts({ routeToken: "SECRET-ROUTE-TOKEN" }), BASE);
    expect(text.match(/https?:\/\/\S+/g)).toEqual(["https://runs.example.org/p/plan-xyz"]);
    expect(text).not.toContain("SECRET-ROUTE-TOKEN");
  });

  it("leaves out what the plan does not have", () => {
    const t = translator("en");
    const onlyDescription = participantNoteText(
      facts({ exactStart: { description: "Kiosk", point: undefined } }),
      BASE,
    );
    expect(onlyDescription).not.toContain(t("note.coordinates", { lat: "", lng: "" }).slice(0, 5));
    const onlyPoint = participantNoteText(
      facts({ exactStart: { description: undefined, point: { lat: 1.5, lng: 2.5 } } }),
      BASE,
    );
    expect(onlyPoint).not.toContain(t("note.place", { place: "" }).slice(0, 5));
    expect(onlyPoint).toContain("1.5, 2.5");
  });
});

describe("the Note", () => {
  const recipient = new URL("https://social.example/users/ben");
  const json = async (note: ReturnType<typeof participantNote>) =>
    (await note.toJsonLd({ format: "compact" })) as Record<string, unknown>;

  it("is addressed to the recipient alone, attributed to the local actor, with HTML-escaped content", async () => {
    const note = participantNote(
      facts({ exactStart: { description: "Kiosk <b>&</b>", point: undefined } }),
      { baseUrl: BASE, recipient },
    );
    const compact = await json(note);
    expect(compact).toMatchObject({
      type: "Note",
      id: "https://runs.example.org/notes/note-abc",
      attributedTo: "https://runs.example.org/actors/instance",
      to: "https://social.example/users/ben",
    });
    expect(compact).not.toHaveProperty("cc");
    expect(compact).not.toHaveProperty("bto");
    expect(compact).not.toHaveProperty("attachment");
    expect(String(compact.content)).toContain("Kiosk &lt;b&gt;&amp;&lt;/b&gt;");
    expect(String(compact.content)).not.toContain("<b>");
  });

  it("says when it was published, and when it was last updated, for receivers to order", async () => {
    const created = await json(participantNote(facts(), { baseUrl: BASE, recipient }));
    expect(created.published).toBe("2026-06-01T08:00:00Z");
    expect(created).not.toHaveProperty("updated");
    const updated = await json(
      participantNote(facts({ updatedAt: new Date("2026-06-02T09:30:00Z") }), {
        baseUrl: BASE,
        recipient,
      }),
    );
    expect(updated).toMatchObject({
      published: "2026-06-01T08:00:00Z",
      updated: "2026-06-02T09:30:00Z",
    });
  });

  it("carries the route as a GPX Document at the secret link", async () => {
    const note = participantNote(facts({ routeToken: "TOKEN-123" }), { baseUrl: BASE, recipient });
    expect((await json(note)).attachment).toMatchObject({
      type: "Document",
      mediaType: "application/gpx+xml",
      url: "https://runs.example.org/federation/notes/TOKEN-123/route.gpx",
    });
  });

  it("has addresses built in one place", () => {
    expect(noteUriOf(BASE, "n1").href).toBe("https://runs.example.org/notes/n1");
    expect(routeLinkOf(BASE, "t1").href).toBe(
      "https://runs.example.org/federation/notes/t1/route.gpx",
    );
  });
});
