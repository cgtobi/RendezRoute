// The plan page's layout (design decision D27): the plan on the left, you and the group on the
// right (one column on phones), name-coloured initials, one main action per page. What each
// audience may see at all is tested in test/privacy; this file tests where it goes.
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { AVATAR_COLOURS, avatarOf } from "../../../src/adapters/in/http/views/avatar.tsx";
import { createTestApp } from "../../support/app.ts";
import { TestClient } from "../../support/client.ts";
import { primaries } from "../../support/html.ts";
import { createPlanViaUi, respondViaUi } from "../../support/plans.ts";

const en = translator("en");
/** The colour "Ben" gets; see the pinning test. */
const BEN_HUE = 5;
const text = (html: string) => html.replaceAll("&#39;", "'");

async function setup() {
  const test = await createTestApp();
  const host = new TestClient(test.app);
  const { planId } = await createPlanViaUi(host);
  const ben = new TestClient(test.app);
  await respondViaUi(ben, planId, "Ben", "joined");
  const emma = new TestClient(test.app);
  await respondViaUi(emma, planId, "Emma", "interested");
  const viewer = new TestClient(test.app);
  const page = async (client: TestClient) => text(await (await client.get(`/p/${planId}`)).text());
  /** After the start: the recap and ratings are open. */
  const start = () => test.clock.advance({ days: 7 });
  return { planId, host, ben, emma, viewer, page, start };
}

/**
 * The plan column, the side column (you and the group) and, once the plan has started, the recap
 * after them, in page order (the order on phones).
 */
function columns(html: string) {
  const main = html.indexOf('<div class="plan-main">');
  const side = html.indexOf('<div class="plan-side">');
  const after = html.indexOf('<div class="plan-after">');
  const end = html.indexOf("</article>");
  expect({ main: main > -1, side: side > main, end: end > side }).toEqual({
    main: true,
    side: true,
    end: true,
  });
  return {
    main: html.slice(main, side),
    side: html.slice(side, after > side ? after : end),
    after: after > side ? html.slice(after, end) : "",
  };
}

describe("plan page layout (decision D27)", () => {
  it("puts the plan on the left and you and the group on the right, on a wide page", async () => {
    const { ben, page } = await setup();
    const html = await page(ben);
    expect(html).toContain('<main class="wide">');
    const { main, side } = columns(html);
    for (const part of ["<h1>", en("plan.exactStart"), "Bring water."])
      expect(main).toContain(part);
    for (const part of [
      en("plan.yourResponse"),
      en("plan.participants"),
      en("plan.addToCalendar"),
    ]) {
      expect(side).toContain(part);
      expect(main).not.toContain(part);
    }
  });

  it("shows a viewer the counts, then the response form, beside the plan", async () => {
    const { viewer, planId, page } = await setup();
    const { side } = columns(await page(viewer));
    const counts = side.indexOf(en("plan.counts", { participants: 1, interested: 1 }));
    expect(counts).toBeGreaterThan(-1);
    expect(side.indexOf(`action="/p/${planId}/respond"`)).toBeGreaterThan(counts);
  });

  it("puts the recap and ratings after you and the group, so phones show the response first", async () => {
    const { ben, page, start } = await setup();
    start();
    const { side, after } = columns(await page(ben));
    expect(side).toContain(en("plan.yourResponse"));
    expect(after).toContain(en("recap.heading"));
    expect(after).toContain(en("rating.heading"));
  });

  it("keeps every label of the plan details for screen readers", async () => {
    const { ben, page } = await setup();
    const html = await page(ben);
    for (const label of ["plan.when", "plan.where", "plan.group"] as const) {
      expect(html).toContain(`<dt class="visually-hidden">${en(label)}</dt>`);
    }
    for (const label of ["plan.distance", "plan.pace"] as const) {
      expect(html).toContain(`<dt>${en(label)}</dt>`);
    }
  });

  it("shows each person with an initial coloured from the name, the host's in the plan's colour", async () => {
    const { ben, host, page } = await setup();
    for (const client of [ben, host]) {
      const html = await page(client);
      expect(html).toContain(
        `<span class="avatar avatar-${avatarOf("Ben", "en").hue}" aria-hidden="true">B</span>`,
      );
      expect(html).toContain('<span class="avatar avatar-host" aria-hidden="true">A</span>');
    }
  });

  it("marks the own response by its kind", async () => {
    const { ben, emma, page } = await setup();
    expect(columns(await page(ben)).side).toContain('class="status status-joined"');
    expect(columns(await page(emma)).side).toContain('class="status status-interested"');
  });

  it("gives each page at most one main action, for every audience before and after the start", async () => {
    const { viewer, ben, emma, host, page, start } = await setup();
    const before = await Promise.all([viewer, ben, emma, host].map(page));
    expect(before.map((html) => primaries(html, '<article class="plan">', "</article>"))).toEqual([
      [en("respond.join")],
      [en("plan.addToCalendar")],
      [en("plan.addToCalendar")],
      [en("plan.addToCalendar")],
    ]);
    start();
    const after = await Promise.all([viewer, ben, emma, host].map(page));
    // Ben may rate (spec 6a); adding to the recap and the calendar are secondary by then.
    expect(after.map((html) => primaries(html, '<article class="plan">', "</article>"))).toEqual([
      [],
      [en("rating.submit")],
      [],
      [],
    ]);
  });
});

describe("avatarOf", () => {
  it("takes the first character of the name, upper-cased in the page's language", () => {
    const initials = ["ben", "Émile", "ølaf", "🏃 Runner", "  carla"].map(
      (name) => avatarOf(name, "en").initial,
    );
    expect(initials).toEqual(["B", "É", "Ø", "🏃", "C"]);
    expect([avatarOf("ilkay", "tr").initial, avatarOf("ilka", "de").initial]).toEqual(["İ", "I"]);
  });

  it("gives a name the same colour however it is written or spaced", () => {
    // "É" as one character and as "E" with a combining accent; surrounding spaces.
    expect(avatarOf("E\u0301mile", "en")).toEqual(avatarOf("\u00c9mile", "en"));
    expect(avatarOf(" Ben ", "en")).toEqual(avatarOf("Ben", "en"));
    // Pinned, so a change of the colour calculation is noticed: it recolours everyone.
    expect(avatarOf("Ben", "en").hue).toBe(BEN_HUE);
  });

  it("spreads names across all the colours", () => {
    const names = [
      "Anna Ben Carla David Emma Felix Greta Hans Ida Jonas Klara Lena Max Nina Otto Paula",
      "Quentin Rosa Sven Tina Uwe Vera Willi Xenia Yusuf Zoe Ahmet Bea Chloé Dörte Élodie",
      "Fatma Gül Hélène Ines Jürgen Kai Lucía Mehmet Noé Øystein Pierre Raphaël Søren Théo",
    ]
      .join(" ")
      .split(" ");
    const counts = Array.from({ length: AVATAR_COLOURS }, () => 0);
    for (const name of names) {
      const { hue } = avatarOf(name, "en");
      counts[hue] = (counts[hue] ?? 0) + 1;
    }
    // 45 names: every colour used, none for more than a quarter of them.
    expect(Math.min(...counts)).toBeGreaterThan(0);
    expect(Math.max(...counts)).toBeLessThanOrEqual(11);
  });
});
