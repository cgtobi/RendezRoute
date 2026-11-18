// The design tokens in public/app.css meet WCAG 2.2 AA in light and dark mode (decision D27):
// text 4.5:1 (1.4.3), field borders and focus rings 3:1 against the page (1.4.11).
import { describe, expect, it } from "vite-plus/test";
import { AVATAR_COLOURS } from "../../src/adapters/in/http/views/avatar.tsx";
import {
  contrastRatio,
  DEFAULT_COLORS,
  parseHexColor,
  TINT_PERCENT,
  tintOn,
} from "../../src/domain/color.ts";
import {
  ATTRIBUTE_SELECTOR,
  bodyText,
  colourTokens,
  customProperties,
  DARK_MEDIA,
  loadStylesheet,
  MEDIA_SELECTOR,
  splitSelectorList,
  type CssRule,
} from "../support/css.ts";

const css = loadStylesheet();

// Each scheme states every tested colour itself: a dark value that is missing, or written in a
// form this test cannot read, fails instead of falling back to the light one. Dark exists twice
// (decision I82): in the media query for the system, and under the attribute for a chosen theme.
// The three blocks are read as rules, wherever they live (top level, in a media query, in a layer).
const blocks = css.tokenBlocks();
// The tests read the FIRST block of each kind, as they always did; later blocks of the same kind
// must not hold a tested token (see "no tested colour hides in a later block").
const firstBlock = (list: readonly CssRule[]) => {
  const rule = list[0];
  if (rule === undefined) throw new Error("a token block is missing");
  return customProperties(rule);
};
const light = colourTokens(firstBlock(blocks.light));
const dark = colourTokens(firstBlock(blocks.dark));
const darkChosen = colourTokens(firstBlock(blocks.darkChosen));

/** [foreground, background, minimum ratio] */
const PAIRS: readonly [string, string, number][] = [
  ["--fg", "--bg", 4.5],
  ["--fg", "--surface", 4.5],
  ["--muted", "--bg", 4.5],
  ["--muted", "--surface", 4.5],
  // Placeholder text (decision D74): WCAG 1.4.3 does not exempt it
  ["--placeholder", "--bg", 4.5],
  ["--placeholder", "--surface", 4.5],
  ["--accent", "--bg", 4.5],
  ["--accent", "--surface", 4.5],
  ["--on-accent", "--accent", 4.5],
  ["--danger", "--bg", 4.5],
  // .error, .required-hint and the fold values sit on the page, and in notices on --surface
  ["--danger", "--surface", 4.5],
  ["--on-danger", "--danger", 4.5],
  ["--fg", "--warning-bg", 4.5],
  ["--field-border", "--bg", 3],
  ["--field-border", "--surface", 3],
  ["--focus", "--bg", 3],
  // The 3 px outline of :focus-visible is a non-text indicator (1.4.11): it also surrounds
  // controls on raised areas and in the status block, where it sits on those fills.
  ["--focus", "--surface", 3],
  ["--focus", "--ok-bg", 3],
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

// The default secondary plan colour (.badge, .host-mark, .avatar-host, .deletion) is stated once,
// in the light block, and is the same in both dark blocks: the dark blocks must not override it.
describe("the default secondary plan colour and its text", () => {
  const names = ["--plan-secondary-default", "--plan-on-secondary-default"];
  it.each([
    ["dark", dark],
    ["dark (chosen, data-theme)", darkChosen],
  ])("is not overridden in %s mode", (_mode, scheme) => {
    expect(names.filter((name) => scheme[name] !== undefined)).toEqual([]);
  });

  it("reaches 4.5:1 for its text (--plan-on-secondary-default on --plan-secondary-default)", () => {
    expect(light["--plan-secondary-default"]).toBeDefined();
    expect(light["--plan-on-secondary-default"]).toBeDefined();
    const ratio = contrastRatio(
      light["--plan-on-secondary-default"] ?? "#ffffff",
      light["--plan-secondary-default"] ?? "#ffffff",
    );
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the placeholder grey (decision D74)", () => {
  it.each([
    ["light", light],
    ["dark", dark],
    ["dark (chosen, data-theme)", darkChosen],
  ])("is not the muted text colour in %s mode", (_mode, scheme) => {
    expect(scheme["--placeholder"]).toBeDefined();
    expect(scheme["--placeholder"]).not.toBe(scheme["--muted"]);
  });

  it("is lighter than --muted on the light page", () => {
    const bg = light["--bg"] ?? "";
    expect(contrastRatio(light["--placeholder"] ?? "", bg)).toBeLessThan(
      contrastRatio(light["--muted"] ?? "", bg),
    );
  });
});

describe("the token blocks", () => {
  it("are found, and no tested colour is defined only in a later block of the same kind", () => {
    expect(blocks.light.length).toBeGreaterThan(0);
    expect(blocks.dark.length).toBeGreaterThan(0);
    expect(blocks.darkChosen.length).toBeGreaterThan(0);
    for (const list of [blocks.light, blocks.dark, blocks.darkChosen]) {
      const later = list.slice(1).flatMap((rule) => Object.keys(customProperties(rule)));
      expect(later.filter((name) => NAMES.includes(name))).toEqual([]);
    }
  });
});

describe("the two dark token blocks (decision I82)", () => {
  it("define the same token names with the same values", () => {
    const media = firstBlock(blocks.dark);
    const chosen = firstBlock(blocks.darkChosen);
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
    const darkRules = css.inMedia(DARK_MEDIA);
    expect(darkRules.length).toBeGreaterThan(0);
    // Every item of every selector list, not only the last one.
    const selectors = darkRules.flatMap((rule) => splitSelectorList(rule.selector));
    expect(selectors.length).toBeGreaterThan(5);
    expect(selectors.filter((s) => !s.startsWith(MEDIA_SELECTOR))).toEqual([]);
  });

  it("set color-scheme per theme", () => {
    expect(bodyText(css.first(":root"))).toContain("color-scheme: light dark");
    expect(bodyText(css.first(':root[data-theme="light"]'))).toContain("color-scheme: light");
    expect(bodyText(css.first(ATTRIBUTE_SELECTOR))).toContain("color-scheme: dark");
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
    const rule = bodyText(css.first(".exact-start"));
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
  /** The rules inside the dark-mode media queries, as text. */
  const darkRules = css.ruleText(css.inMedia(DARK_MEDIA));
  // The media rules sit inside the query; the attribute rules stand outside every at-rule.
  const darkRule = (selector: string) =>
    scope === MEDIA_SELECTOR
      ? bodyText(css.first(`${scope} ${selector}`, { atRule: DARK_MEDIA }))
      : bodyText(css.first(`${scope} ${selector}`));

  it("darkens the tiles, and only the tiles", () => {
    expect(darkRule(".map .leaflet-tile-pane")).toContain("filter: invert(1) hue-rotate(180deg)");
    expect(darkRules).not.toMatch(/\.leaflet-(overlay|marker)-pane[^{]*\{[^}]*filter/);
    expect(css.text).not.toMatch(/data-theme="dark"\][^{]*\.leaflet-(overlay|marker)-pane/);
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
    expect(css.rules(".buttons")).toEqual([]);
    expect(css.rule(".button-row > *")).toContain("flex: 1 1 auto");
    expect(css.rule(".button-row form > button")).toContain("width: 100%");
    expect(css.rule(".button-row > *", { atRule: "min-width: 600px" })).toMatch(/^flex: none;/);
  });

  it("gives a part that starts with a form room below its line, and nothing else", () => {
    expect(css.rule(".sectioned > section:not(.status) > form:first-child")).toContain(
      "margin-top: var(--s4)",
    );
    // A wider rule would override e.g. the delete fold's own margin (.danger-zone).
    expect(css.text).not.toContain(":first-child:not(h2)");
  });
});
