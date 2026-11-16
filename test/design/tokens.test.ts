// The design tokens in public/app.css meet WCAG 2.2 AA in light and dark mode (decision D27):
// text 4.5:1 (1.4.3), field borders and focus rings 3:1 against the page (1.4.11).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { AVATAR_COLOURS } from "../../src/adapters/in/http/views/avatar.tsx";
import {
  contrastRatio,
  DEFAULT_COLORS,
  parseHexColor,
  TINT_PERCENT,
  tintOn,
} from "../../src/domain/color.ts";

const CSS = readFileSync(join(import.meta.dirname, "../../public/app.css"), "utf8");
const DARK = "@media (prefers-color-scheme: dark)";

/**
 * The declarations of the first rule in `css` written for exactly `selector`, at the start of a
 * line (also indented, inside a media query), up to its closing brace; "" if there is none.
 */
function ruleFor(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`\\n[ \\t]*${escapedSelector} \\{\\n`).exec(css);
  return match === null ? "" : css.slice(match.index, css.indexOf("}", match.index));
}

/** The colour tokens of the first rule written for `selector` after `from`, written as #rrggbb. */
function tokens(selector: string, from = 0): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`, from);
  if (from < 0 || start < 0) return {};
  const block = CSS.slice(start, CSS.indexOf("}", start));
  return Object.fromEntries(
    [...block.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2]]),
  );
}

/** Every custom property declaration (`--name: value;`) of the first rule for `selector`. */
function declarations(selector: string, from = 0): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`, from);
  if (from < 0 || start < 0) return {};
  const block = CSS.slice(start, CSS.indexOf("}", start));
  return Object.fromEntries(
    [...block.matchAll(/(--[a-z0-9-]+):\s*([^;]+?)\s*;/gi)].map((m) => [m[1], m[2]]),
  );
}

// Each scheme states every tested colour itself: a dark value that is missing, or written in a
// form this test cannot read, fails instead of falling back to the light one. Dark exists twice
// (decision I82): in the media query for the system, and under the attribute for a chosen theme.
const MEDIA_SELECTOR = ':root:not([data-theme="light"])';
const ATTRIBUTE_SELECTOR = ':root[data-theme="dark"]';
const light = tokens(":root");
const dark = tokens(MEDIA_SELECTOR, CSS.indexOf(DARK));
const darkChosen = tokens(ATTRIBUTE_SELECTOR);

/** [foreground, background, minimum ratio] */
const PAIRS: readonly [string, string, number][] = [
  ["--fg", "--bg", 4.5],
  ["--fg", "--surface", 4.5],
  ["--muted", "--bg", 4.5],
  ["--muted", "--surface", 4.5],
  ["--accent", "--bg", 4.5],
  ["--accent", "--surface", 4.5],
  ["--on-accent", "--accent", 4.5],
  ["--danger", "--bg", 4.5],
  ["--on-danger", "--danger", 4.5],
  ["--fg", "--warning-bg", 4.5],
  ["--field-border", "--bg", 3],
  ["--field-border", "--surface", 3],
  ["--focus", "--bg", 3],
  ["--ok", "--ok-bg", 4.5],
  ["--fg", "--ok-bg", 4.5],
  ["--muted", "--ok-bg", 4.5],
  ["--accent", "--ok-bg", 4.5],
  // Initials on their name colour (plan page people, decision D27)
  ...Array.from({ length: AVATAR_COLOURS }, (_, i): [string, string, number] => [
    `--avatar-${i}-fg`,
    `--avatar-${i}-bg`,
    4.5,
  ]),
];
const NAMES = [...new Set(PAIRS.flatMap(([fg, bg]) => [fg, bg]))];

describe.each([
  ["light", light],
  ["dark", dark],
  ["dark (chosen, data-theme)", darkChosen],
])("design tokens in %s mode", (_mode, scheme) => {
  it("defines every tested colour itself, as #rrggbb", () => {
    expect(NAMES.filter((name) => scheme[name] === undefined)).toEqual([]);
  });

  it.each(PAIRS)("%s on %s reaches %s:1", (fg, bg, minimum) => {
    const ratio = contrastRatio(scheme[fg] ?? "#000000", scheme[bg] ?? "#000000");
    expect(ratio).toBeGreaterThanOrEqual(minimum);
  });
});

describe("the two dark token blocks (decision I82)", () => {
  it("define the same token names with the same values", () => {
    const media = declarations(MEDIA_SELECTOR, CSS.indexOf(DARK));
    const chosen = declarations(ATTRIBUTE_SELECTOR);
    expect(Object.keys(chosen).length).toBeGreaterThan(20);
    const names = [...new Set([...Object.keys(media), ...Object.keys(chosen)])];
    const differs = names.find((name) => media[name] !== chosen[name]);
    // The first difference goes into the failure itself, not into a second argument.
    expect(
      differs === undefined
        ? undefined
        : `${differs}: media "${media[differs]}" vs attribute "${chosen[differs]}"`,
    ).toBeUndefined();
  });

  it("scope every selector in the dark media queries to pages where Light was not chosen", () => {
    const bodies = [...CSS.matchAll(/@media \(prefers-color-scheme: dark\) \{([\s\S]*?)\n\}/g)];
    expect(bodies.length).toBeGreaterThan(0);
    const selectors = bodies.flatMap(([, body = ""]) =>
      [...body.matchAll(/(?:^|\n)[ \t]*([^\s@}][^{}\n]*?)\s*\{/g)].map(([, s = ""]) => s),
    );
    expect(selectors.length).toBeGreaterThan(5);
    expect(selectors.filter((s) => !s.startsWith(MEDIA_SELECTOR))).toEqual([]);
  });

  it("set color-scheme per theme", () => {
    expect(ruleFor(CSS, ":root")).toContain("color-scheme: light dark");
    expect(ruleFor(CSS, ':root[data-theme="light"]')).toContain("color-scheme: light");
    expect(ruleFor(CSS, ATTRIBUTE_SELECTOR)).toContain("color-scheme: dark");
  });
});

/** Plan colours a poster may pick, from the darkest to the lightest (spec 3.1). */
const PLAN_COLOURS = [
  "#000000",
  "#FFFFFF",
  "#1D3F8F",
  "#8A1C2B",
  "#FF0000",
  "#00FF00",
  "#0000FF",
  "#FFEB3B",
  DEFAULT_COLORS.primary,
  DEFAULT_COLORS.secondary,
];
const hex = (value: string) => {
  const parsed = parseHexColor(value);
  if (!parsed.ok) throw new Error(value);
  return parsed.value;
};

// Text on the plan's tints (decision D30): the byline (muted) on the title block's primary tint,
// and all text of the exact start card, which reads in --fg, on the secondary tint.
describe.each([
  ["light", light],
  ["dark", dark],
  ["dark (chosen, data-theme)", darkChosen],
])("text on plan tints in %s mode", (_mode, scheme) => {
  const page = hex(scheme["--bg"] ?? "#000000");
  it.each(PLAN_COLOURS)("stays legible with %s as the plan colour", (colour) => {
    const primaryTint = tintOn(hex(colour), TINT_PERCENT.primary, page);
    const secondaryTint = tintOn(hex(colour), TINT_PERCENT.secondary, page);
    const ratios = {
      title: contrastRatio(scheme["--fg"] ?? "", primaryTint),
      byline: contrastRatio(scheme["--muted"] ?? "", primaryTint),
      exactStart: contrastRatio(scheme["--fg"] ?? "", secondaryTint),
    };
    // Only the parts below 4.5:1, with their ratio.
    expect(Object.entries(ratios).filter(([, ratio]) => ratio < 4.5)).toEqual([]);
  });

  it("reads the exact start card in --fg, its hint and links too", () => {
    const rule = ruleFor(CSS, ".exact-start");
    expect([rule.includes("--muted: var(--fg)"), rule.includes("--accent: var(--fg)")]).toEqual([
      true,
      true,
    ]);
  });
});

// Maps follow dark mode (user request after D30): the tiles darkened in the browser, so it works
// with any tile server, and only the tiles, so the area circle, pins and route keep their colours.
describe.each([
  ["the system is dark", MEDIA_SELECTOR],
  ["dark is chosen", ATTRIBUTE_SELECTOR],
])("maps when %s", (_when, scope) => {
  /** The rules inside the dark-mode media queries, without the token blocks. */
  const darkRules = [...CSS.matchAll(/@media \(prefers-color-scheme: dark\) \{([\s\S]*?)\n\}/g)]
    .map(([, body = ""]) => body)
    .join("\n");
  // The media rules are indented; the attribute rules stand at the top level.
  const darkRule = (selector: string) =>
    scope === MEDIA_SELECTOR
      ? ruleFor(darkRules, `${scope} ${selector}`)
      : ruleFor(CSS, `${scope} ${selector}`);

  it("darkens the tiles, and only the tiles", () => {
    expect(darkRule(".map .leaflet-tile-pane")).toContain("filter: invert(1) hue-rotate(180deg)");
    expect(darkRules).not.toMatch(/\.leaflet-(overlay|marker)-pane[^{]*\{[^}]*filter/);
    expect(CSS).not.toMatch(/data-theme="dark"\][^{]*\.leaflet-(overlay|marker)-pane/);
  });

  it("gives the zoom buttons and the attribution the page's dark colours", () => {
    expect(darkRule(".map .leaflet-bar a")).toContain("background: var(--surface)");
    expect(darkRule(".map.leaflet-container .leaflet-control-attribution")).toContain(
      "color: var(--muted)",
    );
  });
});

// Layout rules closed at the design session's wrap-up (design note in docs/decisions.md, "Closed
// at the wrap-up"): one component for groups of buttons, and room below a part's line.
describe("layout of parts and button rows", () => {
  it("groups buttons only in .button-row, whose buttons fill it on phones and sit side by side from 600 px", () => {
    expect(CSS).not.toMatch(/\n\.buttons \{/);
    expect(ruleFor(CSS, ".button-row > *")).toContain("flex: 1 1 auto");
    expect(ruleFor(CSS, ".button-row form > button")).toContain("width: 100%");
    expect(CSS).toMatch(/@media \(min-width: 600px\) \{\s*\.button-row > \* \{\s*flex: none;/);
  });

  it("gives a part that starts with a form room below its line, and nothing else", () => {
    expect(ruleFor(CSS, ".sectioned > section:not(.status) > form:first-child")).toContain(
      "margin-top: var(--s4)",
    );
    // A wider rule would override e.g. the delete fold's own margin (.danger-zone).
    expect(CSS).not.toContain(":first-child:not(h2)");
  });
});
