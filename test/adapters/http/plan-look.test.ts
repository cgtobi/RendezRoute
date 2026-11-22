// The plan page's look from the phone mock-up (decision D30, replacing parts of D27): the title in
// a block tinted in the plan's primary colour, date and place as plain lines, the measures and the
// drop policy as tiles, the exact start as a card filled with the secondary tint, and who's coming
// as round initials with the name below.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { avatarOf } from "../../../src/adapters/in/http/views/avatar.tsx";
import { loadStylesheet } from "../../support/css.ts";
import { createTestApp } from "../../support/app.ts";
import { TestClient } from "../../support/client.ts";
import { createPlanViaUi, respondViaUi } from "../../support/plans.ts";

const en = translator("en");
const text = (html: string) => html.replaceAll("&#39;", "'");

/** The plan page as Ben, who joined, sees it; or as the host, Anna, with `asHost`. */
async function planPage({ asHost = false } = {}) {
  const test = await createTestApp();
  const host = new TestClient(test.app);
  const { planId } = await createPlanViaUi(host);
  const ben = new TestClient(test.app);
  await respondViaUi(ben, planId, "Ben", "joined");
  return text(await (await (asHost ? host : ben).get(`/p/${planId}`)).text());
}

const css = loadStylesheet();

/**
 * The declarations of the stylesheet's one top-level rule for exactly `selector`; every other rule
 * that names it (e.g. `.plan-header::before`, or inside a media query) is returned too, so a test
 * sees what could override it.
 */
function rule(selector: string): string {
  const own = css.rules(selector, { plain: true });
  if (own.length === 0) throw new Error(`no rule for ${selector}`);
  const others = css.all.filter((r) => r.selector.includes(selector) && !own.includes(r));
  return [css.rule(selector), css.ruleText(others)].join("\n");
}

describe("plan page look (decision D30)", () => {
  it("puts the title in a block tinted in the plan's primary colour, the byline under it", async () => {
    const page = await planPage();
    expect(page).toMatch(
      /<header class="plan-header"><h1>Easy Sunday run<\/h1><p class="plan-byline">/,
    );
    const header = rule(".plan-header");
    expect(header).toContain("background: var(--plan-primary-tint");
    // A block instead of the bar above the title (D27).
    expect(header).not.toMatch(/border(-top)?:/);
  });

  it("shows date and place as plain lines, the measures and the drop policy as tiles", async () => {
    const page = await planPage();
    const main = page.slice(
      page.indexOf('<div class="plan-main">'),
      page.indexOf('<div class="plan-side">'),
    );
    expect(main).toContain('<dl class="when-where lines">');
    expect(main).not.toContain('class="pill"');
    const from = main.indexOf('<dl class="metrics tiles">');
    const tiles = main.slice(from, main.indexOf("</dl>", from));
    expect(tiles).toContain(
      `<div class="metric"><dt>${en("plan.distance")}</dt><dd>12.5 km</dd></div>`,
    );
    expect(tiles).toContain(
      `<div class="metric"><dt class="visually-hidden">${en("plan.group")}</dt><dd>${en("drop.no_drop")}</dd></div>`,
    );
  });

  it("fills the exact start with the plan's secondary tint, without a border", () => {
    const card = rule(".exact-start");
    expect(card).toContain("background: var(--plan-secondary-tint");
    expect(card).not.toContain("border:");
  });

  it("shows who's coming as round initials with the name below, the host marked by an icon", async () => {
    const page = await planPage();
    // The mark follows the name, so it reads "Anna, host"; an icon, the same size in every
    // language, drawn on the initial (D30).
    expect(page).toContain(
      `<li class="person"><span class="avatar avatar-host" aria-hidden="true">A</span><span class="person-label">Anna</span><span class="host-mark"><span class="icon icon-flag" aria-hidden="true"></span><span class="visually-hidden">${en("plan.host")}</span></span></li>`,
    );
    // Ben's own entry reads "Me", the initial and its colour still from his name.
    expect(page).toContain(
      `<li class="person"><span class="avatar avatar-${avatarOf("Ben", "en").hue}" aria-hidden="true">B</span><span class="person-label person-me">${en("plan.me")}</span></li>`,
    );
    expect(rule(".icon-flag")).toContain('--icon: url("icons/flag.svg")');
    expect(
      readFileSync(new URL("../../../public/icons/flag.svg", import.meta.url), "utf8"),
    ).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24"/);
  });

  it("shows the viewer's own entry as Me, set apart in bold; the host's with the host mark", async () => {
    const page = await planPage({ asHost: true });
    expect(en("plan.me")).toBe("Me");
    expect(page).toContain(
      `<li class="person"><span class="avatar avatar-host" aria-hidden="true">A</span><span class="person-label person-me">Me</span><span class="host-mark"><span class="icon icon-flag" aria-hidden="true"></span><span class="visually-hidden">${en("plan.host")}</span></span></li>`,
    );
    expect(page).toContain(
      `<li class="person"><span class="avatar avatar-${avatarOf("Ben", "en").hue}" aria-hidden="true">B</span><span class="person-label">Ben</span></li>`,
    );
    expect(page.match(/person-me/g)).toHaveLength(1);
    // So someone who calls themselves "Me" does not look like the viewer.
    expect(rule(".person-me")).toContain("font-weight: 700");
  });
});
