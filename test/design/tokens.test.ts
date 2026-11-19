// The design tokens in public/app.css meet WCAG 2.2 AA in light and dark mode (decision D27):
// text 4.5:1 (1.4.3), field borders and focus rings 3:1 against the page (1.4.11).
import { describe, expect, it } from "vite-plus/test";
import { AVATAR_COLOURS } from "../../src/adapters/in/http/views/avatar.tsx";
import {
  contrastRatio,
  DEFAULT_COLORS,
  parseHexColor,
  INK_BACKGROUNDS,
  planInk,
  planTheme,
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
  resolveToken,
  stylesheet,
  type CssRule,
  type PageState,
} from "../support/css.ts";
import { PALETTES } from "../../src/domain/palette.ts";

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

// Pre-made palettes (decision 004): public/palettes/<id>.css redefines the colour tokens. Each is
// held to the same tests as the default: contrast pairs, every tested name as #rrggbb, identical
// dark blocks, a placeholder apart from muted, legible plan tints, and no override of the default
// secondary plan colour.
const SHIPPED = PALETTES.filter((id) => id !== "default");

/** Specificity of a token block selector: :root, attribute selectors and the :not() argument count one each. */
const specificity = (selector: string) =>
  (selector.match(/:root/g)?.length ?? 0) + (selector.match(/\[/g)?.length ?? 0);

describe("the shipped palettes list", () => {
  it("has a stylesheet per non-default palette", () => {
    expect(SHIPPED).toEqual(["mono", "bold"]);
  });
});

describe.each(SHIPPED)("palette %s", (id) => {
  const sheet = loadStylesheet(`palettes/${id}.css`);
  const palette = sheet.tokenBlocks(id);
  const pLight = colourTokens(firstBlock(palette.light));
  const pDark = colourTokens(firstBlock(palette.dark));
  const pChosen = colourTokens(firstBlock(palette.darkChosen));
  const schemes = [
    ["light", pLight],
    ["dark", pDark],
    ["dark (chosen, data-theme)", pChosen],
  ] as const;

  it("has exactly one block of each kind", () => {
    expect([palette.light.length, palette.dark.length, palette.darkChosen.length]).toEqual([
      1, 1, 1,
    ]);
  });

  it("states the same colour tokens in all three blocks, and the app's colour tokens only", () => {
    const names = Object.keys(pLight).toSorted();
    expect(Object.keys(pDark).toSorted()).toEqual(names);
    expect(Object.keys(pChosen).toSorted()).toEqual(names);
    expect(names.filter((name) => light[name] === undefined)).toEqual([]);
    // Not a single non-colour token (type, space, radius, size) in any block.
    for (const list of [palette.light, palette.dark, palette.darkChosen]) {
      for (const rule of list) {
        const all = Object.keys(customProperties(rule));
        expect(all.filter((name) => pLight[name] === undefined && name !== "--r-button")).toEqual(
          [],
        );
      }
    }
  });

  it.each(schemes)("defines every tested colour itself, as #rrggbb, in %s mode", (_m, scheme) => {
    expect(NAMES.filter((name) => scheme[name] === undefined)).toEqual([]);
  });

  describe.each(schemes)("contrast in %s mode", (_mode, scheme) => {
    it.each(PAIRS)("%s on %s reaches %s:1", (fg, bg, minimum) => {
      const ratio = contrastRatio(scheme[fg] ?? "#000000", scheme[bg] ?? "#000000");
      expect(ratio).toBeGreaterThanOrEqual(minimum);
    });

    it("keeps the placeholder apart from the muted text", () => {
      expect(scheme["--placeholder"]).not.toBe(scheme["--muted"]);
    });

    it.each(PLAN_COLOURS)("keeps text legible on the plan tints of %s", (colour) => {
      const page = hex(scheme["--bg"] ?? "#000000");
      const primaryTint = tintOn(hex(colour), TINT_PERCENT.primary, page);
      const secondaryTint = tintOn(hex(colour), TINT_PERCENT.secondary, page);
      const ratios = {
        title: contrastRatio(scheme["--fg"] ?? "", primaryTint),
        byline: contrastRatio(scheme["--muted"] ?? "", primaryTint),
        exactStart: contrastRatio(scheme["--fg"] ?? "", secondaryTint),
      };
      expect(Object.entries(ratios).filter(([, ratio]) => ratio < 4.5)).toEqual([]);
    });
  });

  it("has a placeholder lighter than muted on the light page", () => {
    const bg = pLight["--bg"] ?? "";
    expect(contrastRatio(pLight["--placeholder"] ?? "", bg)).toBeLessThan(
      contrastRatio(pLight["--muted"] ?? "", bg),
    );
  });

  it("has two identical dark blocks (same names, same values)", () => {
    const media = firstBlock(palette.dark);
    const chosen = firstBlock(palette.darkChosen);
    const { "color-scheme": _unused, ...chosenTokens } = chosen;
    expect(chosenTokens).toEqual(media);
  });

  it("scopes every selector in the dark media query to pages where Light was not chosen", () => {
    const selectors = sheet.inMedia(DARK_MEDIA).flatMap((rule) => splitSelectorList(rule.selector));
    expect(selectors).toEqual([`:root[data-palette="${id}"]:not([data-theme="light"])`]);
  });

  it("does not override the default secondary plan colour, nor any non-colour token", () => {
    for (const rule of sheet.all) {
      const names = Object.keys(customProperties(rule));
      expect(names.filter((name) => name.startsWith("--plan-"))).toEqual([]);
      expect(
        names.filter(
          (name) => /^--(text|s\d|r-|target|header)/.test(name) && name !== "--r-button",
        ),
      ).toEqual([]);
    }
  });

  // --r-button, the buttons' corner radius, is the one non-colour token a palette may set, in the
  // light block only, and only mono and bold set it: mono rounds its buttons to the pill radius,
  // bold squares them. A palette not listed here keeps the app's radius.
  const BUTTON_RADIUS: Readonly<Record<string, string>> = {
    mono: "var(--r-pill)",
    bold: "0px",
  };
  it("sets --r-button only in the light block", () => {
    for (const list of [palette.dark, palette.darkChosen]) {
      for (const rule of list) expect(customProperties(rule)["--r-button"]).toBeUndefined();
    }
    expect(firstBlock(palette.light)["--r-button"]).toBe(BUTTON_RADIUS[id]);
  });

  it.each([
    ["light", { palette: id, systemDark: false }],
    ["dark", { palette: id, theme: "dark", systemDark: true }],
  ] as const)("resolves --r-button through the cascade in %s mode", (_name, page) => {
    const combinedSheet = stylesheet(`${css.text} ${sheet.text}`);
    const own = BUTTON_RADIUS[id];
    // A palette without its own value keeps the app's radius.
    expect(resolveToken(combinedSheet, "--r-button", page)).toBe(own ?? "var(--r-md)");
    // Followed to the length: mono 999px, bold 0px, any other palette the app's --r-md.
    const reference = /^var\((--[\w-]+)\)$/.exec(own ?? "var(--r-md)")?.[1];
    const length = reference === undefined ? own : resolveToken(combinedSheet, reference, page);
    const appMd = resolveToken(stylesheet(css.text), "--r-md", page);
    const lengths: Readonly<Record<string, string>> = {
      mono: "999px",
      bold: "0px",
    };
    expect(length).toBe(lengths[id] ?? appMd);
  });

  it("keeps ok and danger recognisable (green and red hues)", () => {
    const hue = (value: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
      const max = Math.max(r ?? 0, g ?? 0, b ?? 0);
      return { r: r ?? 0, g: g ?? 0, b: b ?? 0, max };
    };
    for (const [, scheme] of schemes) {
      const ok = hue(scheme["--ok"] ?? "");
      const danger = hue(scheme["--danger"] ?? "");
      expect(ok.g).toBe(ok.max);
      expect(danger.r).toBe(danger.max);
    }
  });

  it("keeps the accent apart from --ok in every scheme", () => {
    for (const [, scheme] of schemes) {
      const [accent, ok] = [scheme["--accent"] ?? "", scheme["--ok"] ?? ""];
      const channels = (v: string) => [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
      const distance = Math.hypot(...channels(accent).map((c, i) => c - (channels(ok)[i] ?? 0)));
      expect(distance).toBeGreaterThan(60);
    }
  });

  it("keeps the eight avatar colours distinct from each other", () => {
    for (const [, scheme] of schemes) {
      const backgrounds = Array.from(
        { length: AVATAR_COLOURS },
        (_, i) => scheme[`--avatar-${i}-bg`],
      );
      expect(new Set(backgrounds).size).toBe(AVATAR_COLOURS);
    }
  });

  it("wins over app.css without !important: same layer, higher specificity per scheme", () => {
    expect(sheet.text).not.toContain("!important");
    expect(css.layerOrder()[0]).toBe("tokens");
    const rules = [palette.light[0], palette.dark[0], palette.darkChosen[0]];
    expect(rules.map((rule) => rule?.layer)).toEqual(["tokens", "tokens", "tokens"]);
    const app = [blocks.light[0], blocks.dark[0], blocks.darkChosen[0]];
    const [pl, pd, pc] = rules.map((rule) => specificity(rule?.selector ?? ""));
    const [al, ad, ac] = app.map((rule) => specificity(rule?.selector ?? ""));
    expect([pl, pd, pc]).toEqual([2, 3, 3]);
    expect([al, ad, ac]).toEqual([1, 2, 2]);
    // The palette's block of a scheme beats every app block that can apply together with it,
    // and its own light block never outranks its dark blocks.
    expect(pl).toBeGreaterThan(al ?? 99);
    expect(pd).toBeGreaterThan(Math.max(ad ?? 99, pl ?? 99));
    expect(pc).toBeGreaterThan(Math.max(ac ?? 99, pl ?? 99));
  });

  it("sits in the same cascade layer as the app's token blocks when loaded after app.css", () => {
    const combined = stylesheet(`${css.text} ${sheet.text}`);
    const appRank = combined.layerRank(combined.first(":root"));
    const paletteRank = combined.layerRank(combined.first(`:root[data-palette="${id}"]`));
    expect(paletteRank).toBe(appRank);
    expect(combined.layerOrder()[0]).toBe("tokens");
  });

  // The real cascade (layer, then specificity, then source order) over app.css followed by the
  // palette sheet: the palette's value must be the final one in every state a page can be in.
  const combined = stylesheet(`${css.text} ${sheet.text}`);
  // A plan page: bold's black-outside-events rule (:not(:has(.plan, .host))) does not apply to it.
  const EVENT = { contains: ["plan"] } as const;
  const STATES: readonly [string, PageState, Record<string, string>][] = [
    ["light, system light", { palette: id, systemDark: false, ...EVENT }, pLight],
    ["system dark, no theme chosen", { palette: id, systemDark: true, ...EVENT }, pDark],
    [
      "chosen light on a light system",
      { palette: id, theme: "light", systemDark: false, ...EVENT },
      pLight,
    ],
    [
      "chosen light on a dark system",
      { palette: id, theme: "light", systemDark: true, ...EVENT },
      pLight,
    ],
    [
      "chosen dark on a light system",
      { palette: id, theme: "dark", systemDark: false, ...EVENT },
      pChosen,
    ],
    [
      "chosen dark on a dark system",
      { palette: id, theme: "dark", systemDark: true, ...EVENT },
      pChosen,
    ],
  ];
  describe.each(STATES)("cascade: %s", (_name, page, expected) => {
    it.each(["--bg", "--fg", "--accent", "--surface"])(
      "resolves %s to the palette's value, not app.css's",
      (token) => {
        const value = resolveToken(combined, token, page);
        expect(value).toBe(expected[token]);
        // Without the palette sheet the page would get app.css's value; it must not leak.
        const app = resolveToken(css, token, {
          ...EVENT,
          systemDark: page.systemDark,
          ...(page.theme === undefined ? {} : { theme: page.theme }),
        });
        expect(app).not.toBe(value);
      },
    );
  });
});

// Mono's component rules (decision 004): the only palette that restyles more than tokens. Every
// such rule is scoped by its palette attribute, sits in "pages" (after components and layout) and
// needs no !important; the other palettes carry none, and app.css has none for mono.
describe("mono's component rules", () => {
  const mono = loadStylesheet("palettes/mono.css");
  const isTokenBlock = (selector: string) =>
    /^:root\[data-palette="mono"\](?:\[|:not|$)/.test(selector);
  const componentRules = mono.all.filter((rule) => !isTokenBlock(rule.selector));

  it('has component rules, all scoped by :root[data-palette="mono"] and none with !important', () => {
    expect(componentRules.length).toBeGreaterThan(10);
    for (const rule of componentRules) {
      expect(rule.selector.startsWith(':root[data-palette="mono"] ')).toBe(true);
    }
    expect(mono.text).not.toContain("!important");
  });

  it("puts them in the pages layer, which app.css declares after components and layout", () => {
    expect(componentRules.map((rule) => rule.layer)).toEqual(componentRules.map(() => "pages"));
    const order = css.layerOrder();
    expect(order.indexOf("pages")).toBeGreaterThan(order.indexOf("components"));
    expect(order.indexOf("pages")).toBeGreaterThan(order.indexOf("layout"));
    const combined = stylesheet(`${css.text} ${mono.text}`);
    expect(combined.layerOrder()).toEqual(order);
  });

  it("centres the home page's hero, button and link and makes the button full width", () => {
    expect(mono.rule(':root[data-palette="mono"] .home > p:not(.notice)')).toContain(
      "text-align: center",
    );
    const button = mono.rule(':root[data-palette="mono"] .home > p > .button');
    expect(button).toContain("width: 100%");
    expect(button).toContain("display: flex");
  });

  it("adds a dot after the plan's activity in the plan colour, blue (--focus) without one", () => {
    const dot = mono.rule(':root[data-palette="mono"] .plan-activity::after');
    expect(dot).toContain("background: var(--plan-primary, var(--focus))");
    const { light, darkChosen } = mono.tokenBlocks("mono");
    expect(firstBlock(light)["--focus"]).toBe("#2c67a8");
    expect(firstBlock(darkChosen)["--focus"]).toBe("#8bb8ea");
  });

  it("flattens the plan page: no tinted header, no grey tiles, unboxed start, status and notices", () => {
    const rule = (selector: string) => mono.rule(`:root[data-palette="mono"] ${selector}`);
    expect(rule(".plan-header")).toContain("background: transparent");
    expect(rule(".plan-header")).toContain("padding: 0");
    expect(rule('.plan-header h1, :root[data-palette="mono"] .host h1')).toContain(
      "font-weight: 400",
    );
    expect(rule(".plan-activity")).toContain("background: transparent");
    expect(rule(".plan-activity")).toContain("letter-spacing: 0.08em");
    expect(rule(".tiles .metric")).toContain("background: transparent");
    expect(rule(".metrics.tiles")).toContain("border-block: 1px solid var(--line)");
    expect(rule(".exact-start")).toContain("background: transparent");
    expect(rule(".exact-start")).toContain("border-radius: 0");
    expect(rule(".status")).toContain("background: transparent");
    expect(rule(".status")).toContain("border: 0");
    expect(rule(".counts")).toContain("background: transparent");
    const notices = rule('.notice,\n  :root[data-palette="mono"] .warning');
    expect(notices).toContain("background: transparent");
    expect(notices).toContain("border-left: 2px solid");
  });

  it("styles the host page and forms with hairlines and regular type, fields untouched", () => {
    const rule = (selector: string) => mono.rule(`:root[data-palette="mono"] ${selector}`);
    expect(rule("fieldset")).toContain("border-top: 1px solid var(--line)");
    expect(rule("fieldset")).toContain("border: 0");
    expect(rule(".plan-form .title-input")).toContain("font-weight: 400");
    expect(rule(".host.sectioned > section:not(.status) > h2")).toContain(
      "text-transform: uppercase",
    );
    // No rule of mono styles a field control itself, so --field-border stays what app.css gives.
    for (const item of componentRules) {
      expect(item.selector).not.toMatch(/(?:^|[\s,>])(?:input|select|textarea)\b/);
    }
  });

  it("never changes outlines, target sizes or --target in the plan and host rules", () => {
    const added = mono.text.slice(mono.text.indexOf("The plan page and the host page"));
    expect(added).not.toMatch(/outline|--target|min-height|min-width|!important/);
    expect(added).not.toContain(":focus");
  });

  it("leaves the other palettes and app.css without such rules", () => {
    for (const id of SHIPPED.filter((other) => other !== "mono")) {
      const sheet = loadStylesheet(`palettes/${id}.css`);
      expect(sheet.all.filter((rule) => rule.layer !== "tokens")).toEqual([]);
    }
    expect(css.text).not.toContain('data-palette="mono"');
  });
});

// Bold's structural rules (decision 004) live in app.css, not in its palette sheet: every one is
// scoped by its palette attribute, none uses !important, they sit in "pages" (the map's frame is
// unlayered like .map itself), and bold.css holds token-layer rules only.
describe("bold's component rules", () => {
  const scope = ':root[data-palette="bold"]';
  // Pages outside an event: the main holds neither a plan nor the host's page. The template
  // editor's section is a .host too, but an account page, so it carries .template.
  const NON_EVENT = `${scope}:not(:has(.plan, .host:not(.template)))`;
  const bold = loadStylesheet("palettes/bold.css");
  const rules = css.all.filter((rule) => rule.selector.includes('data-palette="'));
  const boldBlocks = bold.tokenBlocks("bold");
  const boldTokens = {
    light: colourTokens(firstBlock(boldBlocks.light)),
    dark: colourTokens(firstBlock(boldBlocks.dark)),
  };

  it("mentions data-palette only in bold-scoped selectors, each item of every list", () => {
    expect(rules.length).toBeGreaterThan(10);
    const items = rules.flatMap((rule) => splitSelectorList(rule.selector));
    // A descendant selector, the root itself in one of the three colour scheme states (the plan
    // ink, defined in the same states as bold.css's own tokens), or the root of a page outside an
    // event (the one :has() form below).
    const states = [
      NON_EVENT,
      `${scope}:not([data-theme="dark"])`,
      `${MEDIA_SELECTOR}[data-palette="bold"]`,
      `${scope}[data-theme="dark"]`,
    ];
    expect(items.filter((item) => !item.startsWith(`${scope} `) && !states.includes(item))).toEqual(
      [],
    );
    expect(css.text.match(/data-palette="[^"]*"/g)?.every((m) => m === 'data-palette="bold"')).toBe(
      true,
    );
  });

  it("has no unscoped bold rule: every bold rule starts with the scope", () => {
    expect(css.all.filter((rule) => rule.selector.includes('"bold"'))).toEqual(rules);
  });

  it("uses no !important and sits in pages, except the unlayered map frames", () => {
    const body = rules.map((rule) => rule.body).join("\n");
    expect(body).not.toContain("!important");
    const unlayered = [`${scope} .map`, `${scope} .map.plan-map`];
    for (const rule of rules) {
      const expected = unlayered.includes(rule.selector) ? undefined : "pages";
      expect([rule.selector, rule.layer]).toEqual([rule.selector, expected]);
    }
    const order = css.layerOrder();
    expect(order.indexOf("pages")).toBeGreaterThan(order.indexOf("components"));
  });

  it("zeroes the corners and shadows of cards, headers, pills and the stub", () => {
    const flat = rules.find((rule) => rule.selector.includes(`${scope} .plan-header,`));
    expect(flat?.body).toContain("border-radius: 0");
    expect(flat?.body).toContain("box-shadow: none");
    for (const name of [
      ".plan-activity",
      ".badge",
      ".notice",
      ".exact-start",
      ".metrics",
      ".note",
      ".plan-after",
      ".plan-side",
      "fieldset",
    ]) {
      expect(flat?.selector).toContain(`${scope} ${name}`);
    }
  });

  it("perforates the private start and sets the poster numerals", () => {
    expect(css.rule(`${scope} .exact-start`)).toContain("border-top: 2px dashed var(--line)");
    const numerals = css.rule(`${scope} .metric dd`);
    for (const part of ["font-weight: 800", "tabular-nums", "letter-spacing: -0.03em"]) {
      expect(numerals).toContain(part);
    }
    expect(numerals).toContain("overflow-wrap: break-word");
    expect(numerals).toContain("min-width: 0");
  });

  it("sets the title block as a solid poster band with bold uppercase type", () => {
    const header = css.rule(`${scope} .plan-header`);
    expect(header).toContain("background: var(--plan-primary, var(--accent))");
    expect(header).toContain("color: var(--plan-on-primary, var(--on-accent))");
    expect(header).toContain("border-bottom: 2px solid var(--line)");
    expect(header).not.toContain("transparent");
    const type = css.rule(`${scope} .plan-header h1, ${scope} .plan-byline`);
    for (const part of [
      "text-transform: uppercase",
      "font-weight: 800",
      "letter-spacing: -0.02em",
      "overflow-wrap: break-word",
      "min-width: 0",
      "color: inherit",
    ]) {
      expect(type).toContain(part);
    }
    expect(css.rule(`${scope} .plan-byline a`)).toContain("color: inherit");
    // Long compounds break inside the band: the base h1 rule's wrapping is kept and hyphens set.
    const h1 = css.rule(`${scope} .plan-header h1`);
    expect(h1).toContain("hyphens: auto");
    expect(type).toContain("overflow-wrap: break-word");
    expect(type).toContain("min-width: 0");
  });

  it("stamps the activity in the band's own pair, and inverts a focused link in the band", () => {
    const stamp = css.rule(`${scope} .plan-activity`);
    expect(stamp).toContain("background: var(--plan-on-primary, var(--bg))");
    expect(stamp).toContain("color: var(--plan-primary, var(--fg))");
    const link = css.rule(`${scope} .plan-header a:focus-visible`);
    expect(link).toContain("background: var(--plan-on-primary, var(--on-accent))");
    expect(link).toContain("color: var(--plan-primary, var(--accent))");
  });

  it("sets the private start as a filled stub with an eyebrow heading", () => {
    const stub = css.rule(`${scope} .exact-start`);
    expect(stub).toContain("border-top: 2px dashed var(--line)");
    expect(stub).toContain("border-radius: 0");
    expect(stub).toContain("background: var(--plan-secondary-tint, var(--surface))");
    expect(stub).toContain("--muted: var(--fg)");
    expect(stub).toContain("--accent: var(--fg)");
    const eyebrow = css.rule(`${scope} .exact-start h2`);
    expect(eyebrow).toContain("text-transform: uppercase");
    expect(eyebrow).toContain("font-size: var(--text-xs)");
  });

  it("splits the measures into poster cells with 2 px rules", () => {
    const band = css.rule(`${scope} .metrics`);
    expect(band).toContain("border-block: 2px solid var(--line)");
    expect(band).toContain("min-width: 0");
    expect(band).toContain("overflow-wrap: break-word");
    // Each divider is the grid's 2 px gap, seen through to the container's --line: drawn once.
    const grid = css.rule(`${scope} .metrics.tiles`);
    expect(grid).toContain("gap: 2px");
    expect(grid).toContain("background: var(--line)");
    const cell = css.rule(`${scope} .tiles .metric`);
    expect(cell).toContain("border: 0");
    expect(cell).toContain("background: var(--bg)");
    expect(cell).toContain("min-width: 0");
    // No per-cell side or top dividers any more.
    expect(css.all.filter((r) => /nth-child\((even|n \+ 3)\)/.test(r.selector))).toEqual([]);
    expect(css.rule(`${scope} .tiles .metric:last-child:nth-child(odd)`)).toContain(
      "grid-column: 1 / -1",
    );
    const value = css.rule(`${scope} .tiles .metric dd`);
    for (const part of [
      "font-size: 1.5rem",
      "font-weight: 800",
      "tabular-nums",
      "letter-spacing: -0.03em",
      "overflow-wrap: break-word",
      "min-width: 0",
    ]) {
      expect(value).toContain(part);
    }
    // Text values (the drop policy) are smaller and lighter, and still wrap.
    const text = css.rule(`${scope} .tiles .metric:has(> dt.visually-hidden) dd`);
    for (const part of ["font-size: 1.125rem", "line-height: 1.25", "font-weight: 700"]) {
      expect(text).toContain(part);
    }
  });

  // The band, the stamp and the stub take the plan's colours (theme.css), so their text is checked
  // against every preset and a few extremes, through the real domain functions.
  describe.each([
    ["light", boldTokens.light],
    ["dark", boldTokens.dark],
  ] as const)("on plan colours in %s mode", (_mode, scheme) => {
    const page = hex(scheme["--bg"] ?? "#000000");
    const EXTREMES = ["#FFF176", "#0B1F3A", "#808080", "#FF0000", "#00FF00"];
    it.each([...PLAN_COLOURS, ...EXTREMES])("keeps 4.5:1 with %s as the plan colour", (colour) => {
      const theme = planTheme({ primary: hex(colour), secondary: hex(colour) });
      const secondaryTint = tintOn(theme.secondary, TINT_PERCENT.secondary, page);
      const ratios = {
        // header text, byline and its links: --plan-on-primary on --plan-primary
        header: contrastRatio(theme.onPrimary, theme.primary),
        // stamp: background --plan-on-primary, text --plan-primary
        stamp: contrastRatio(theme.primary, theme.onPrimary),
        // focused link in the band: the same pair, swapped
        focusedLink: contrastRatio(theme.primary, theme.onPrimary),
        // stub text, hint and links, all remapped to --fg, on the secondary tint
        stubText: contrastRatio(scheme["--fg"] ?? "", secondaryTint),
        stubHint: contrastRatio(scheme["--fg"] ?? "", secondaryTint),
      };
      expect(Object.entries(ratios).filter(([, ratio]) => ratio < 4.5)).toEqual([]);
    });
  });

  // Links, the logo and the site name take the plan's ink (planInk) on bold's page: text 4.5:1,
  // and 5:1 by design so that the menu and the cards (--surface) pass too; the logo needs 3:1.
  describe.each([
    ["light", boldTokens.light],
    ["dark", boldTokens.dark],
  ] as const)("the plan ink in %s mode", (mode, scheme) => {
    const page = scheme["--bg"] ?? "#000000";
    const EXTREMES = ["#FFF176", "#0B1F3A", "#808080", "#FF0000", "#00FF00"];
    it("is made for exactly bold's --bg", () => {
      expect(INK_BACKGROUNDS[mode].toLowerCase()).toBe(page);
    });
    it.each([...PLAN_COLOURS, ...EXTREMES])("is readable with %s as the plan colour", (colour) => {
      const ink = planInk(hex(colour));
      const chosen = mode === "light" ? ink.onLight : ink.onDark;
      expect(contrastRatio(chosen, page)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(chosen, scheme["--surface"] ?? page)).toBeGreaterThanOrEqual(4.5);
      // On the host page it is also the fill of buttons and checked controls, with --bg on it.
      expect(contrastRatio(page, chosen)).toBeGreaterThanOrEqual(4.5);
    });
  });

  it("sets the status, the notice and the warning as blocks between horizontal rules", () => {
    const status = css.rule(`${scope} .status`);
    expect(status).toContain("border-block: 2px solid var(--line)");
    expect(status).toContain("background: transparent");
    const notice = css.rule(`${scope} .notice`);
    expect(notice).toContain("border-block: 2px solid var(--line)");
    expect(notice).toContain("background: transparent");
    expect(css.rule(`${scope} .plan-side > .status:first-child`)).toContain("border-top: 0");
    expect(css.rule(`${scope} .plan-main > .notice:nth-child(2)`)).toContain("border-top: 0");
    expect(css.rule(`${scope} .warning`)).toContain("border-block: 2px solid var(--warning-line)");
    // No vertical accent bar on any of them (joined state: the green icon and label carry it).
    const blocks = css.all.filter((r) =>
      /\.(status|status-joined|status-loggedIn|notice|warning)$/.test(r.selector.trim()),
    );
    expect(blocks.length).toBeGreaterThan(3);
    for (const block of blocks.filter((r) => r.selector.includes(scope))) {
      expect(block.body).not.toMatch(/border-(left|right|inline)/);
    }
  });

  it("frames the grid bands with 2 px rules", () => {
    for (const selector of [
      `${scope} .site-footer`,
      `${scope} .plan-after`,
      `${scope} .plan-side .actions`,
    ]) {
      expect(css.rule(selector)).toContain("border-top: 2px solid var(--line)");
    }
    expect(css.rule(`${scope} .note`)).toContain("border-bottom: 2px solid var(--line)");
    expect(css.rule(`${scope} .plan-side, ${scope} .plan .share`)).toContain(
      "border-top: 2px solid var(--line)",
    );
  });

  it("gives the host page's dirty save bar a heavy 2 px top rule and nothing else", () => {
    const bar = css.rule(`${scope} .save-bar[data-dirty]`);
    expect(bar).toBe("border-top-width: 2px;");
  });

  it("takes the frame off the burger and nothing else of it", () => {
    const burger = css.rule(`${scope} .burger`);
    expect(burger).toContain("border-color: transparent");
    expect(burger).toContain("background: transparent");
    expect(burger).not.toMatch(/width|height|padding|outline/);
  });

  it("sets the start line's numerals like the measures'", () => {
    const start = css.rule(`${scope} .when-where.lines div:first-child dd`);
    for (const part of ["font-weight: 800", "tabular-nums", "letter-spacing: -0.03em"]) {
      expect(start).toContain(part);
    }
    expect(start).toContain("min-width: 0");
    expect(start).toContain("overflow-wrap: break-word");
  });

  // Full width: the frame has no side margin, the bands reach the viewport's edges and the text in
  // them keeps the --bd-gutter indent.
  it("runs the header, the footer and the bands edge to edge, with an indented column", () => {
    const frame = css.rule(`${scope} :is(main, .site-header, .site-footer)`);
    expect(frame).toContain("max-width: none");
    expect(frame).toContain("margin-inline: 0");
    expect(frame).toContain("padding-inline: var(--bd-gutter)");
    // On a phone the indent is --s4; on a large screen it centres the old 40rem column.
    expect(frame).toContain("--bd-gutter: max(var(--s4), calc((100vw - 40rem) / 2 + var(--s4)))");
    expect(frame).toContain("--bd-bleed-l: var(--bd-gutter)");
    expect(frame).toContain("--bd-bleed-r: var(--bd-gutter)");
    const wide = css.rule(`${scope} :is(main, .site-header, .site-footer).wide`, {
      atRule: "min-width: 960px",
    });
    expect(wide).toContain("calc((100vw - 72rem) / 2 + var(--s4))");
    const band = css.all.find(
      (rule) => rule.selector.startsWith(`${scope} :is(.plan-header,`) && rule.layer === "pages",
    );
    for (const name of [
      ".plan-header",
      ".metrics:not(.tiles)",
      ".exact-start",
      ".plan .share",
      ".status",
      ".notice",
      ".save-bar",
      ".sectioned > section:not(.status)",
    ]) {
      expect(band?.selector).toContain(name);
    }
    expect(band?.body).toContain("margin-left: calc(-1 * var(--bd-bleed-l))");
    expect(band?.body).toContain("margin-right: calc(-1 * var(--bd-bleed-r))");
    expect(band?.body).toContain("padding-left: var(--bd-bleed-l)");
    expect(band?.body).toContain("padding-right: var(--bd-bleed-r)");
    // The tiles' container is the line colour: it bleeds by margin only, never by padding.
    const tiles = css.rule(`${scope} .metrics.tiles`);
    expect(tiles).toContain("margin-left: calc(-1 * var(--bd-bleed-l))");
    expect(tiles).not.toContain("padding-left");
    // The plan map's frame bleeds too, without side borders (unlayered, like .map).
    const map = css.all.find((rule) => rule.selector === `${scope} .map.plan-map`);
    expect(map?.layer).toBeUndefined();
    expect(map?.body).toContain("margin-left: calc(-1 * var(--bd-bleed-l))");
    expect(map?.body).toContain("border-inline: 0");
  });

  it("meets the plan column and the group column at the rule from 960 px", () => {
    const side = css.all.find(
      (rule) => rule.selector === `${scope} main .plan > .plan-side` && rule.atRules.length > 0,
    );
    expect(side?.atRules.join()).toContain("min-width: 960px");
    expect(side?.body).toContain("--bd-bleed-l: var(--s6)");
    expect(side?.body).toContain("border-left: 2px solid var(--line)");
    const main = css.all.find((rule) => rule.selector.startsWith(`${scope} main .plan > :is(`));
    expect(main?.body).toContain("--bd-bleed-r: var(--s6)");
  });

  // The plan's ink (decision 007): links, the logo and the site name in the plan's primary colour,
  // made readable by the domain (theme.css) and chosen per scheme here; bold's red without a plan.
  it("selects the plan ink per scheme, falling back to the accent", () => {
    const own = (selector: string, atRule?: string) =>
      css.all.find(
        (rule) =>
          rule.selector === selector &&
          rule.layer === "pages" &&
          (atRule === undefined
            ? rule.atRules.length === 1
            : rule.atRules.some((at) => at.includes(atRule))),
      )?.body;
    // Light: unless dark was chosen; the system's dark rule comes later with the same specificity.
    expect(own(`${scope}:not([data-theme="dark"])`)).toContain(
      "--plan-ink: var(--plan-ink-on-light, var(--accent))",
    );
    expect(own(`${MEDIA_SELECTOR}[data-palette="bold"]`, "prefers-color-scheme: dark")).toContain(
      "--plan-ink: var(--plan-ink-on-dark, var(--accent))",
    );
    expect(own(`${scope}[data-theme="dark"]`)).toContain(
      "--plan-ink: var(--plan-ink-on-dark, var(--accent))",
    );
    // bold.css stays tokens only and does not know the ink.
    expect(bold.text).not.toContain("plan-ink");
  });

  // Black is the primary colour outside an event: --accent, --on-accent and --plan-ink are remapped
  // to the ink and the page colour of the scheme. The resolver evaluates the :has() form through
  // PageState.contains (the classes of the page's main), so the cascade is checked per scheme.
  describe("black outside events", () => {
    const combinedBold = stylesheet(`${css.text} ${bold.text}`);
    const rule = css.all.find((r) => r.selector === NON_EVENT);
    const SCHEMES: readonly [string, PageState][] = [
      ["light", { palette: "bold", systemDark: false }],
      ["system dark", { palette: "bold", systemDark: true }],
      ["chosen light on a dark system", { palette: "bold", theme: "light", systemDark: true }],
      ["chosen dark on a light system", { palette: "bold", theme: "dark", systemDark: false }],
      ["chosen dark on a dark system", { palette: "bold", theme: "dark", systemDark: true }],
    ];

    it("is one pages-layer rule in the bold scope that remaps exactly three tokens", () => {
      expect(rule?.layer).toBe("pages");
      expect(rule?.atRules).toEqual(["@layer pages"]);
      expect(rule?.body).toBe(
        "--accent: var(--fg); --on-accent: var(--bg); --plan-ink: var(--fg);",
      );
      expect(rule?.body).not.toContain("!important");
    });

    it("is more specific than the three scheme rules of the plan ink, so order is irrelevant", () => {
      const ink = css.all.filter(
        (r) => r.layer === "pages" && r.body.startsWith("--plan-ink:") && r.selector !== NON_EVENT,
      );
      expect(ink.length).toBe(3);
      // :root + [data-palette] + :not(:has(.host:not(.template))) = 1 + 1 + 2 > 3 (the media form).
      expect(NON_EVENT.match(/\./g)?.length).toBe(3);
    });

    describe.each(SCHEMES)("in %s", (_name, scheme) => {
      it.each(["--accent", "--plan-ink"])("resolves %s to --fg outside an event", (token) => {
        for (const contains of [[], ["template", "host"]]) {
          expect(resolveToken(combinedBold, token, { ...scheme, contains })).toBe("var(--fg)");
        }
      });
      it("resolves --on-accent to --bg outside an event", () => {
        expect(resolveToken(combinedBold, "--on-accent", { ...scheme, contains: [] })).toBe(
          "var(--bg)",
        );
      });
      it("leaves the plan page and the host page on bold's red and the plan ink", () => {
        for (const contains of [["plan"], ["host"], ["host", "sectioned"]]) {
          const page = { ...scheme, contains };
          const dark = scheme.theme === "dark" || (scheme.theme === undefined && scheme.systemDark);
          const tokens = dark ? boldTokens.dark : boldTokens.light;
          expect(resolveToken(combinedBold, "--accent", page)).toBe(tokens["--accent"]);
          expect(resolveToken(combinedBold, "--on-accent", page)).toBe(tokens["--on-accent"]);
          expect(resolveToken(combinedBold, "--plan-ink", page)).toBe(
            dark
              ? "var(--plan-ink-on-dark, var(--accent))"
              : "var(--plan-ink-on-light, var(--accent))",
          );
        }
      });
    });

    it("does not touch the other palettes or the default", () => {
      for (const palette of [undefined, "mono"]) {
        const page = { systemDark: false, contains: [], ...(palette ? { palette } : {}) };
        expect(resolveToken(combinedBold, "--on-accent", page)).not.toBe("var(--bg)");
      }
    });

    it("keeps the pairs readable: --bg on --fg is at least 15:1 in light and dark", () => {
      for (const scheme of [boldTokens.light, boldTokens.dark]) {
        expect(contrastRatio(scheme["--bg"] ?? "", scheme["--fg"] ?? "")).toBeGreaterThanOrEqual(
          15,
        );
      }
    });

    it("keeps links underlined, so black links differ from body text without colour", () => {
      const base = css.all.filter(
        (r) =>
          r.layer !== "tokens" &&
          /(^|, |\s)a(:|,|$)/.test(r.selector) &&
          /text-decoration/.test(r.body),
      );
      expect(base.some((r) => /text-decoration:\s*underline/.test(r.body))).toBe(true);
      // The link colour rule of bold does not remove it, and the rule above does not either.
      expect(rule?.body).not.toContain("text-decoration");
    });
  });

  it("colours links, the logo, the site name and the footer's links with the plan ink", () => {
    const links = css.all.find(
      (rule) => rule.selector.startsWith(`${scope} a:not(`) && rule.layer === "pages",
    );
    expect(links?.body).toBe("color: var(--plan-ink, var(--accent));");
    for (const item of [
      `${scope} .site-header-menu > a`,
      `${scope} .site-footer a`,
      `${scope} .zone-change`,
    ]) {
      expect(splitSelectorList(links?.selector ?? "")).toContain(item);
    }
    // Not on buttons, the band's links, the stub's, the danger zone's, the warning's or the save bar's.
    for (const left of [".button", ".plan-header a", ".exact-start a", ".danger-zone a"]) {
      expect(links?.selector).toContain(left);
    }
    expect(links?.selector).toContain(".warning a");
    expect(links?.selector).toContain(".save-bar-status a");
    // The ink never replaces a state's text colour: no other bold rule sets a link colour.
    expect(links?.body).not.toContain("text-decoration");
  });

  // The host page follows the plan's colour (its head links the plan's theme.css for bold only).
  it("makes every accent on the host page the plan ink, with the page colour on it", () => {
    const host = css.all.find((rule) => rule.selector === `${scope} .host`);
    expect(host?.layer).toBe("pages");
    expect(host?.body).toBe("--accent: var(--plan-ink); --on-accent: var(--bg);");
    // The ink itself is defined on the root with the accent as fallback, so --accent here is not circular.
    expect(host?.body).not.toContain("var(--accent)");
    // Checkboxes and radios take it through accent-color: --accent, the browser picks the mark.
    expect(css.rule('input[type="radio"], input[type="checkbox"]')).toContain(
      "accent-color: var(--accent)",
    );
    // Only the host page: the plan page's own colouring is the --plan-primary rules above.
    expect(css.all.filter((r) => /--accent:\s*var\(--plan-ink\)/.test(r.body)).length).toBe(1);
  });

  it("changes no focus outline and no target size", () => {
    const body = rules.map((rule) => rule.body).join("\n");
    expect(body).not.toMatch(/outline|min-height|--target/);
  });

  it("keeps bold.css to token-layer rules", () => {
    expect(bold.all.length).toBeGreaterThan(0);
    expect(bold.all.filter((rule) => rule.layer !== "tokens")).toEqual([]);
  });
});
