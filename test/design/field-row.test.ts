// Layout guards for public/app.css. They only catch someone deleting or rewriting the lines below;
// that the layout really works is proven by the Playwright check e2e/layout-phone.spec.ts.
//
// 1. Two fields side by side (.field-row) must be able to shrink below the intrinsic width of the
//    native date and time inputs. iOS Safari gives them a large min-content width; with a plain
//    `1fr` track (minmax(auto, 1fr)) the columns stop shrinking and the second input overflows.
// 2. The footer menu's preference rows (.preference) keep select and button on one line.
import { describe, expect, it } from "vite-plus/test";
import { declarations, loadStylesheet } from "../support/css.ts";

const css = loadStylesheet();

/** The declarations of every top-level rule written for exactly this selector list, joined. */
const declarationsFor = (selectors: string) => css.rule(selectors, { anyOrder: true });

describe(".field-row", () => {
  it("uses minmax(0, 1fr) tracks so native date/time inputs cannot widen the row", () => {
    const rule = declarationsFor(".field-row");
    expect(rule).toMatch(
      /grid-template-columns: repeat\(\s*2\s*,\s*minmax\(\s*0\s*,\s*1fr\s*\)\s*\)/,
    );
    expect(rule).not.toMatch(/grid-template-columns: 1fr 1fr/);
  });

  it("lets its children shrink", () => {
    expect(declarationsFor(".field-row > *")).toMatch(/min-width: 0(?![.\d])/);
    expect(declarationsFor(".field-row > .field")).toMatch(/min-width: 0(?![.\d])/);
  });

  it("drops the native iOS date/time look so the box obeys its column (decision D59)", () => {
    const rule = declarationsFor('input[type="time"], input[type="date"]');
    expect(rule).toMatch(/-webkit-appearance: none/);
    expect(rule).toMatch(/(?<![-\w])appearance: none/);
    expect(rule).toMatch(/display: block/);
    expect(rule).toMatch(/inline-size: 100%/);
    expect(rule).toMatch(/min-inline-size: 0(?![.\d])/);
    expect(rule).toMatch(/max-inline-size: 100%/);
    expect(rule).toMatch(/box-sizing: border-box/);
    expect(rule).toMatch(/margin: 0(?![.\d])/);
    expect(
      declarationsFor(
        'input[type="time"]::-webkit-datetime-edit, input[type="date"]::-webkit-datetime-edit',
      ),
    ).toMatch(/padding: 0(?![.\d])/);
  });

  it("lets date and time inputs shrink and start-aligns their text", () => {
    // Same result whichever order the two selectors are written in.
    const rule = declarationsFor('input[type="time"], input[type="date"]');
    expect(rule).toMatch(/min-width: 0(?![.\d])/);
    expect(rule).toMatch(/max-width: 100%/);
    expect(rule).toMatch(/text-align: start/);
  });
});

describe("select", () => {
  it("drops the native look (WebKit ignores box styling otherwise) and draws its own arrow", () => {
    const rule = declarationsFor("select");
    expect(rule).toMatch(/-webkit-appearance: none/);
    expect(rule).toMatch(/(?<![-\w])appearance: none/);
    const image = /background-image: ([^;]*);/.exec(rule)?.[1] ?? "";
    expect(image.match(/linear-gradient\(/g)?.length).toBe(2);
    expect(image.match(/var\(--fg\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(image).not.toMatch(/url\(/);
    expect(rule).toMatch(/background-repeat: no-repeat/);
    expect(rule).toMatch(/padding-right: calc\(var\(--s3\) \+ 1\.75rem\)/);
  });

  it("keeps the arrow: the generic rule's background shorthand comes first", () => {
    const generic = css.all.find((rule) =>
      rule.selector.startsWith('input:not([type="radio"], [type="checkbox"], [type="color"]), '),
    );
    expect(generic).toBeDefined();
    // The first rule at or after the generic one (in the cascade) that sets the shorthand.
    const shorthand = css.earliest(
      css.all.filter(
        (rule) =>
          rule.body.includes("background: var(--bg)") &&
          generic !== undefined &&
          (rule === generic || css.isLater(rule, generic)),
      ),
    );
    const arrow = css.earliest(
      css.rules("select", { plain: true }).filter((rule) => rule.body.includes("background-image")),
    );
    expect(shorthand).toBeDefined();
    expect(arrow, "a plain `select` rule with the arrow").toBeDefined();
    expect(shorthand !== undefined && arrow !== undefined && css.isLater(arrow, shorthand)).toBe(
      true,
    );
    expect(declarationsFor("select")).not.toMatch(/(?<![-\w])background: /);
  });
});

describe("body", () => {
  it("breaks a word that is longer than the line, so plain text never scrolls the page sideways", () => {
    expect(declarationsFor("body")).toMatch(/overflow-wrap: break-word/);
  });
});

describe(".preference (menu sheet)", () => {
  it("lets the select take the remaining space and shrink", () => {
    const rule = declarationsFor(".preference select");
    expect(rule).toMatch(/flex: 1 1 0(?![.\w])/);
    expect(rule).toMatch(/min-width: 0(?![.\d])/);
  });

  it("keeps the button as wide as its text, on one line", () => {
    const rule = declarationsFor(".preference button");
    expect(rule).toMatch(/flex: none/);
    expect(rule).toMatch(/white-space: nowrap/);
  });

  it("keeps the label on one line with the select at 320 px (no stacking override)", () => {
    expect(css.text).not.toMatch(/max-width: 339/);
  });

  it("makes the header sticky and the sheet fill the width under it", () => {
    expect(declarationsFor(".site-header-menu")).toMatch(/position: sticky/);
    expect(declarationsFor(".site-header-menu")).toMatch(/top: 0/);
    // Exactly `@supports selector(:popover-open)`, not the `not` variant below.
    const supported = css.within("supports", "selector(:popover-open)");
    expect(supported.length).toBeGreaterThan(0);
    expect(
      supported.some((rule) => rule.atRules.includes("@supports selector(:popover-open)")),
    ).toBe(true);
    expect(supported.some((rule) => rule.atRules.join(" ").includes("not selector"))).toBe(false);
  });

  it("keeps the sticky header, hairline and grid off the plain (admin) header", () => {
    const plain = declarationsFor(".site-header");
    expect(plain).not.toMatch(/position|border|display|background|grid/);
  });

  it("centres the logo with a three-column grid: 44 px spacer, logo, burger", () => {
    const rule = declarationsFor(".site-header-menu");
    expect(rule).toMatch(/grid-template-columns: var\(--target\) 1fr var\(--target\)/);
    expect(declarationsFor(".site-header-menu > a")).toMatch(/justify-self: center/);
    expect(declarationsFor(".site-header-menu > a")).toMatch(/min-height: var\(--target\)/);
    expect(declarationsFor(".site-header-menu > a")).toMatch(/overflow-wrap: anywhere/);
    const before = css.first(".site-header-menu::before", { plain: true });
    expect(declarations(before.body)[0]).toEqual({ property: "content", value: '""' });
  });

  it("puts the menu in its own full-width row under the logo without popover support", () => {
    const without = css.within("supports", "not selector(:popover-open)");
    expect(without.length).toBeGreaterThan(0);
    expect(
      without.every((rule) => rule.atRules.includes("@supports not selector(:popover-open)")),
    ).toBe(true);
    const block = css.ruleText(without);
    expect(block).toMatch(/\.site-header-menu \{ position: static;/);
    expect(block).toMatch(/#site-menu \{ grid-column: 1 \/ -1; grid-row: 2;/);
    expect(block).toMatch(/\.burger \{ display: none;/);
  });

  it("makes every map its own stacking context so Leaflet panes stay below the header", () => {
    expect(declarationsFor(".map")).toMatch(/isolation: isolate/);
  });
});

describe("zone line and host name summary texts", () => {
  it("shows Change when closed and Done under details[open]", () => {
    expect(declarationsFor(".zone-change-open")).toMatch(/display: none/);
    expect(declarationsFor("details[open] > summary .zone-change-open")).toMatch(/display: inline/);
    expect(declarationsFor("details[open] > summary .zone-change-closed")).toMatch(/display: none/);
  });
});
