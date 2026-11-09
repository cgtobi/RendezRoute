// Rating the plan through the web pages (spec 6a, decision D20), step 1.
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { createPlanViaUi, respondViaUi } from "../../support/plans.ts";

const en = translator("en");
const AFTER_START = "2026-06-07T06:00:00Z";
const CLOSED = "2026-06-14T05:30:00Z";
const NOTE = "SENTINEL-rating-note";
const section = (html: string) =>
  /<section class="rating" id="rating">[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
const text = (html: string) => html.replaceAll("&#39;", "'");

async function setup() {
  const test = await createTestApp();
  const host = new TestClient(test.app);
  const { planId } = await createPlanViaUi(host);
  const ben = new TestClient(test.app);
  await respondViaUi(ben, planId, "Ben", "joined");
  const lea = new TestClient(test.app);
  await respondViaUi(lea, planId, "Lea", "joined");
  const ida = new TestClient(test.app);
  await respondViaUi(ida, planId, "Ida", "interested");
  return { ...test, host, ben, lea, ida, planId };
}

async function rate(client: TestClient, planId: string, value: string, note = "") {
  const csrf = hiddenFields(await (await client.get(`/p/${planId}`)).text())._csrf ?? "";
  return client.postForm(`/p/${planId}/rating`, { _csrf: csrf, value, note });
}

describe("the rating section (spec 6a)", () => {
  it("appears for participants from the start, with the honesty line, and for nobody else", async () => {
    const { host, ben, ida, app, planId, clock } = await setup();
    expect(section(await (await ben.get(`/p/${planId}`)).text())).toBe("");
    clock.set(AFTER_START);
    const own = section(await (await ben.get(`/p/${planId}`)).text());
    expect(own).toContain(`action="/p/${planId}/rating"`);
    expect(own).toContain(en("rating.honesty"));
    expect(own).not.toContain("/rating/delete");
    for (const client of [host, ida, new TestClient(app)]) {
      expect(section(await (await client.get(`/p/${planId}`)).text())).toBe("");
    }
  });

  it("saves, changes and removes a rating, and shows it only to its author", async () => {
    const { host, ben, lea, planId, clock } = await setup();
    clock.set(AFTER_START);
    const saved = await rate(ben, planId, "down", NOTE);
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe(`/p/${planId}#rating`);
    const page = section(await (await ben.get(`/p/${planId}`)).text());
    expect(page).toContain('value="down" checked=""');
    expect(page).toContain(NOTE);
    expect(page).toContain(`action="/p/${planId}/rating/delete"`);
    for (const client of [lea, host]) {
      expect(await (await client.get(`/p/${planId}`)).text()).not.toContain(NOTE);
    }

    await rate(ben, planId, "up");
    expect(section(await (await ben.get(`/p/${planId}`)).text())).toContain(
      'value="up" checked=""',
    );
    const csrf = hiddenFields(await (await ben.get(`/p/${planId}`)).text())._csrf ?? "";
    const removed = await ben.postForm(`/p/${planId}/rating/delete`, { _csrf: csrf });
    expect(removed.status).toBe(303);
    expect(section(await (await ben.get(`/p/${planId}`)).text())).not.toContain("checked");
  });

  it("shows errors on the form's own page", async () => {
    const { ben, planId, clock } = await setup();
    clock.set(AFTER_START);
    const invalid = await rate(ben, planId, "meh", "x".repeat(501));
    expect(invalid.status).toBe(422);
    const html = text(await invalid.text());
    expect(html).toContain(en("field.choice_invalid"));
    expect(html).toContain(en("field.too_long"));
  });

  it("closes with the recap, keeping the participant's own rating visible to them", async () => {
    const { ben, lea, planId, clock } = await setup();
    clock.set(AFTER_START);
    await rate(ben, planId, "up", `${NOTE} https://example.org/photos`);
    clock.set(CLOSED);
    const closed = section(await (await ben.get(`/p/${planId}`)).text());
    expect(text(closed)).toContain(en("rating.yours"));
    expect(closed).toContain(en("rating.up"));
    expect(closed).toContain('href="https://example.org/photos"');
    expect(closed).not.toContain("<form");
    expect(closed).not.toContain(en("rating.honesty"));
    expect(text(section(await (await lea.get(`/p/${planId}`)).text()))).toContain(
      en("rating.closed"),
    );
    const late = await rate(lea, planId, "down");
    expect(late.status).toBe(409);
  });

  it("refuses interested people and posts without the CSRF token", async () => {
    const { ben, ida, planId, clock } = await setup();
    clock.set(AFTER_START);
    expect((await rate(ida, planId, "up")).headers.get("location")).toBe(`/p/${planId}`);
    const forged = await ben.postForm(`/p/${planId}/rating`, { value: "up", note: "" });
    expect(forged.status).toBe(403);
  });
});

describe("the host's result (spec 6a, step 2)", () => {
  const result = (html: string) =>
    /<section class="rating-result"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";

  it("shows a hint until the recap closes, then counts and signed, linked notes", async () => {
    const { host, ben, lea, app, planId, clock } = await setup();
    await respondViaUi(new TestClient(app), planId, "Max", "joined");
    clock.set(AFTER_START);
    await rate(ben, planId, "down", `${NOTE} https://example.org/too-fast`);
    await rate(lea, planId, "up");
    expect(text(result(await (await host.get(`/p/${planId}/host`)).text()))).toContain(
      en("rating.resultLater"),
    );
    expect(await (await host.get(`/p/${planId}`)).text()).not.toContain("rating-result");

    clock.set(CLOSED);
    for (const path of [`/p/${planId}/host`, `/p/${planId}`]) {
      const shown = text(result(await (await host.get(path)).text()));
      expect(shown).toContain(en("rating.result", { count: 2, participants: 3, up: 1, down: 1 }));
      expect(shown).toContain("<strong>Ben</strong>");
      expect(shown).toContain(NOTE);
      expect(shown).toContain('href="https://example.org/too-fast"');
    }
  });

  it("says plans with fewer than 3 participants show no ratings", async () => {
    const { host, ben, planId, clock } = await setup();
    clock.set(AFTER_START);
    await rate(ben, planId, "up", NOTE);
    clock.set(CLOSED);
    const page = text(result(await (await host.get(`/p/${planId}/host`)).text()));
    expect(page).toContain(en("rating.resultTooFew"));
    expect(page).not.toContain(NOTE);
  });
});
