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

/** The colour tokens of the first `:root { … }` block after `from`, written as #rrggbb. */
function tokens(from: number): Record<string, string> {
  const start = CSS.indexOf(":root {", from);
  if (from < 0 || start < 0) return {};
  const block = CSS.slice(start, CSS.indexOf("}", start));
  return Object.fromEntries(
    [...block.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2]]),
  );
}

// Each scheme states every tested colour itself: a dark value that is missing, or written in a
// form this test cannot read, fails instead of falling back to the light one.
const light = tokens(0);
const dark = tokens(CSS.indexOf(DARK));

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
])("design tokens in %s mode", (_mode, scheme) => {
  it("defines every tested colour itself, as #rrggbb", () => {
    expect(NAMES.filter((name) => scheme[name] === undefined)).toEqual([]);
  });

  it.each(PAIRS)("%s on %s reaches %s:1", (fg, bg, minimum) => {
    const ratio = contrastRatio(scheme[fg] ?? "#000000", scheme[bg] ?? "#000000");
    expect(ratio).toBeGreaterThanOrEqual(minimum);
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
    const card = CSS.slice(CSS.indexOf("\n.exact-start {\n"));
    const rule = card.slice(0, card.indexOf("}"));
    expect([rule.includes("--muted: var(--fg)"), rule.includes("--accent: var(--fg)")]).toEqual([
      true,
      true,
    ]);
  });
});

// Maps follow dark mode (user request after D30): the tiles darkened in the browser, so it works
// with any tile server, and only the tiles, so the area circle, pins and route keep their colours.
describe("maps in dark mode", () => {
  /** The rules inside the dark-mode media queries, without the token blocks. */
  const darkRules = [...CSS.matchAll(/@media \(prefers-color-scheme: dark\) \{([\s\S]*?)\n\}/g)]
    .map(([, body = ""]) => body)
    .join("\n");
  const ruleFor = (selector: string) => {
    const start = darkRules.indexOf(`${selector} {`);
    return start === -1 ? "" : darkRules.slice(start, darkRules.indexOf("}", start));
  };

  it("darkens the tiles, and only the tiles", () => {
    expect(ruleFor(".map .leaflet-tile-pane")).toContain("filter: invert(1) hue-rotate(180deg)");
    expect(darkRules).not.toMatch(/\.leaflet-(overlay|marker)-pane[^{]*\{[^}]*filter/);
  });

  it("gives the zoom buttons and the attribution the page's dark colours", () => {
    expect(ruleFor(".map .leaflet-bar a")).toContain("background: var(--surface)");
    expect(ruleFor(".map.leaflet-container .leaflet-control-attribution")).toContain(
      "color: var(--muted)",
    );
  });
});
