import { describe, expect, it } from "vite-plus/test";
import {
  ATTRIBUTE_SELECTOR,
  colourTokens,
  customProperties,
  type CssRule,
  declarations,
  MEDIA_SELECTOR,
  normalizeCss,
  normalizeQuotes,
  normalizeSelector,
  parseCss,
  readCss,
  readCssRaw,
  splitSelectorList,
  stripComments,
  stylesheet,
  wrapInLayer,
} from "./css.ts";

const FIXTURE = `
/* a comment with { braces } and ; semicolons */
@layer reset, base, components;

@layer reset {
  * { box-sizing: border-box; }
}

@layer components {
  .button { color: red; }
  .button:hover, .button:focus { color: blue; }
  @media (forced-colors: active) {
    .button { color: ButtonText; }
  }
  @media (min-width: 600px) {
    @supports (display: grid) {
      .grid { display: grid; }
    }
  }
}

@media (forced-colors: none) {
  @layer base {
    a:focus-visible { outline: none; }
  }
}

.plain { margin: 0; }
`;

describe("normalisation", () => {
  it("strips comments, turns ' into \" and collapses whitespace", () => {
    expect(normalizeCss("a /* x\n y */ {\n  content: 'b';\n}")).toBe('a { content: "b"; }');
  });

  it("keeps comment markers that sit inside strings", () => {
    expect(stripComments('a { content: "/* not */"; } /* gone */ b {}')).toBe(
      'a { content: "/* not */"; }   b {}',
    );
  });

  it("matches what the tests used to compute by hand", () => {
    const raw = readCssRaw();
    const old = raw
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/'/g, '"')
      .replace(/\s+/g, " ");
    expect(normalizeCss(readCssRaw())).toBe(old);
  });

  it("wraps the file in a layer when CSS_TEST_WRAP_LAYER is set", () => {
    const before = process.env["CSS_TEST_WRAP_LAYER"];
    try {
      process.env["CSS_TEST_WRAP_LAYER"] = "components";
      expect(readCss("styleguide.css")).toMatch(/^@layer components \{\s+\.sg-section/);
      delete process.env["CSS_TEST_WRAP_LAYER"];
      expect(readCss("styleguide.css")).toMatch(/^\s*\.sg-section/);
    } finally {
      if (before === undefined) delete process.env["CSS_TEST_WRAP_LAYER"];
      else process.env["CSS_TEST_WRAP_LAYER"] = before;
    }
  });

  it("normalises selectors without touching strings and attribute selectors", () => {
    expect(normalizeSelector("a,b ,  c>d+e~f")).toBe("a, b, c > d + e ~ f");
    expect(normalizeSelector(":is( a ,b ) :not( .x , .y )")).toBe(":is(a, b) :not(.x, .y)");
    expect(normalizeSelector('[title="a , b>c"]  [a~="x"]')).toBe('[title="a , b>c"] [a~="x"]');
    expect(normalizeSelector(".sm\\:flex\\,x")).toBe(".sm\\:flex\\,x");
  });

  it("splits selector lists at top-level commas only", () => {
    expect(splitSelectorList(':is(a, b):not(.c, .d), [x="1,2"], e')).toEqual([
      ":is(a, b):not(.c, .d)",
      '[x="1,2"]',
      "e",
    ]);
  });

  it("splits declarations, keeping ; and : inside parentheses and strings", () => {
    expect(
      declarations(
        'background: url("data:image/svg+xml;utf8,<svg/>") no-repeat; --x: calc(1px + 2px);content: ";";color:red',
      ),
    ).toEqual([
      { property: "background", value: 'url("data:image/svg+xml;utf8,<svg/>") no-repeat' },
      { property: "--x", value: "calc(1px + 2px)" },
      { property: "content", value: '";"' },
      { property: "color", value: "red" },
    ]);
  });
});

describe("parseCss", () => {
  const { rules, statements } = parseCss(FIXTURE);
  const find = (selector: string) => rules.filter((r) => r.selector === selector);

  it("reads `@layer a, b;` as a statement, not a rule", () => {
    expect(statements.map((s) => s.text)).toEqual(["@layer reset, base, components"]);
    expect(rules.some((r) => r.selector.startsWith("@layer"))).toBe(false);
  });

  it("returns a flat list in source order with the enclosing at-rules and the layer", () => {
    expect(rules.map((r) => r.selector)).toEqual([
      "*",
      ".button",
      ".button:hover, .button:focus",
      ".button",
      ".grid",
      "a:focus-visible",
      ".plain",
    ]);
    expect(rules.map((r) => r.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(find("*")[0]).toMatchObject({ atRules: ["@layer reset"], layer: "reset" });
    expect(find(".plain")[0]).toMatchObject({ atRules: [], layer: undefined });
  });

  it("nests @media inside @layer", () => {
    expect(find(".button")[1]).toMatchObject({
      atRules: ["@layer components", "@media (forced-colors: active)"],
      layer: "components",
    });
  });

  it("nests @layer inside @media, and @supports inside @media inside @layer", () => {
    expect(find("a:focus-visible")[0]).toMatchObject({
      atRules: ["@media (forced-colors: none)", "@layer base"],
      layer: "base",
    });
    expect(find(".grid")[0]?.atRules).toEqual([
      "@layer components",
      "@media (min-width: 600px)",
      "@supports (display: grid)",
    ]);
  });

  it("treats @font-face and @keyframes as rules of their own", () => {
    const parsed = parseCss(
      '@font-face { font-family: "A"; src: url("a.woff2"); } @keyframes spin { from { opacity: 0; } to { opacity: 1; } } .a { b: c; }',
    );
    expect(parsed.rules.map((r) => r.selector)).toEqual(["@font-face", "@keyframes spin", ".a"]);
    expect(parsed.rules[1]?.body).toContain("from { opacity: 0; }");
  });

  it("treats an anonymous @layer as a container without a name", () => {
    const parsed = parseCss("@layer { .a { b: c; } }");
    expect(parsed.rules[0]).toMatchObject({ selector: ".a", layer: undefined });
    expect(parsed.rules[0]?.atRules).toEqual(["@layer"]);
  });

  it("handles braces and semicolons in strings and url(), and escaped characters", () => {
    const parsed = parseCss(
      [
        '.a::before { content: "}{;"; }',
        '.b { background: url(data:image/svg+xml;utf8,<svg a="{"/>); color: red; }',
        ".c { content: 'it\\'s }'; }",
        ".sm\\:flex\\{x { display: flex; }",
        '[data-x="a{b}"] > .d { e: f; }',
        ".last { g: h; }",
      ].join("\n"),
    );
    expect(parsed.rules.map((r) => r.selector)).toEqual([
      ".a::before",
      ".b",
      ".c",
      ".sm\\:flex\\{x",
      '[data-x="a{b}"] > .d',
      ".last",
    ]);
    expect(parsed.rules[0]?.body).toBe('content: "}{;";');
    expect(declarations(parsed.rules[1]?.body ?? "").map((d) => d.property)).toEqual([
      "background",
      "color",
    ]);
  });

  it("keeps commas inside :is() and :not() as one selector list", () => {
    const parsed = parseCss(
      ":is(a, b):not(.c,.d) > p,\n.e { x: y; }\n:where(.f:has(:required:placeholder-shown)) { z: 1; }",
    );
    expect(parsed.rules.map((r) => r.selector)).toEqual([
      ":is(a, b):not(.c, .d) > p, .e",
      ":where(.f:has(:required:placeholder-shown))",
    ]);
  });

  it("ignores comments anywhere, including between a selector and its block", () => {
    const parsed = parseCss("/* x */ .a /* y { */ , .b /* z */ { c: d; /* } */ e: f; }");
    expect(parsed.rules).toHaveLength(1);
    expect(parsed.rules[0]?.selector).toBe(".a, .b");
    expect(declarations(parsed.rules[0]?.body ?? "").map((d) => d.property)).toEqual(["c", "e"]);
  });

  it("keeps an apostrophe inside a double-quoted string, and a quote inside a single-quoted one", () => {
    expect(
      parseCss('.a::before { content: "it\'s }"; } .b { c: d; }').rules.map((r) => r.selector),
    ).toEqual([".a::before", ".b"]);
    expect(
      parseCss(".a::before { content: 'say \"hi\" }'; } .b { c: d; }").rules.map((r) => r.selector),
    ).toEqual([".a::before", ".b"]);
    expect(normalizeQuotes(`.a { content: "it's"; b: 'x'; c: 'say "hi"'; d: 'it\\'s'; }`)).toBe(
      `.a { content: "it's"; b: "x"; c: "say \\"hi\\""; d: "it's"; }`,
    );
  });

  it("reads @import as a statement, nested @layer with a dotted name, and a statement in a block", () => {
    const parsed = parseCss(`
      @import url("x.css") layer(base);
      @layer outer { @layer x, y; @layer inner { .a { b: c; } } .d { e: f; } }
    `);
    expect(parsed.statements.map((s) => s.text)).toEqual([
      '@import url("x.css") layer(base)',
      "@layer x, y",
    ]);
    expect(parsed.statements[1]?.atRules).toEqual(["@layer outer"]);
    expect(parsed.rules.map((r) => [r.selector, r.layer])).toEqual([
      [".a", "outer.inner"],
      [".d", "outer"],
    ]);
    expect(parsed.rules[0]?.atRules).toEqual(["@layer outer", "@layer inner"]);
  });

  it("tolerates an unclosed block and a stray brace", () => {
    expect(parseCss(".a { b: c; } } .d { e: f; ").rules.map((r) => r.selector)).toEqual([
      ".a",
      ".d",
    ]);
  });

  it("reads rules nested in a style rule (CSS nesting) as part of its body", () => {
    const parsed = parseCss(".a { color: red; &:hover { color: blue; } } .b { c: d; }");
    expect(parsed.rules.map((r) => r.selector)).toEqual([".a", ".b"]);
    expect(declarations(parsed.rules[0]?.body ?? "")).toEqual([
      { property: "color", value: "red" },
    ]);
  });
});

describe("Stylesheet", () => {
  const css = stylesheet(FIXTURE);

  it("rules() matches the whole selector list, whatever the comma spacing", () => {
    expect(css.rules(".button:hover,.button:focus")).toHaveLength(1);
    expect(css.rules(".button:hover")).toHaveLength(0);
    expect(css.rules(".button")).toHaveLength(2);
  });

  it("rules() filters by enclosing at-rule text, by layer, by plainness and by list order", () => {
    expect(css.rules(".button", { atRule: "forced-colors: active" })).toHaveLength(1);
    expect(css.rules(".button", { atRule: "forced-colors: none" })).toHaveLength(0);
    expect(css.rules("a:focus-visible", { atRule: "forced-colors: none" })).toHaveLength(1);
    expect(css.rules(".button", { layer: "components" })).toHaveLength(2);
    expect(css.rules(".button", { layer: "base" })).toHaveLength(0);
    expect(css.rules(".button", { plain: true })).toHaveLength(1);
    expect(css.rules(".button:focus, .button:hover", { anyOrder: true })).toHaveLength(1);
    expect(css.rules(".button:focus, .button:hover")).toHaveLength(0);
  });

  it("rule() joins declarations, ignoring @media copies unless asked", () => {
    expect(css.rule(".button")).toBe("color: red;");
    expect(css.rule(".button", { atRule: "forced-colors: active" })).toBe("color: ButtonText;");
    expect(css.rule("*")).toBe("box-sizing: border-box;");
    expect(css.rule(".plain")).toBe("margin: 0;");
  });

  it("rule() throws when nothing matches, and for a selector that only exists in a media query", () => {
    expect(() => css.rule(".nope")).toThrow(/no rule for "\.nope"/);
    expect(() => css.rule(".grid")).toThrow(/no rule/);
    expect(css.rule(".grid", { plain: false })).toBe("display: grid;");
    expect(() => css.rule("a:focus-visible", { atRule: "forced-colors: active" })).toThrow(
      /forced-colors: active/,
    );
  });

  it("hasRule() looks anywhere, or inside an at-rule", () => {
    expect(css.hasRule(".grid")).toBe(true);
    expect(css.hasRule(".grid", "min-width: 600px")).toBe(true);
    expect(css.hasRule(".grid", "min-width: 900px")).toBe(false);
    expect(css.hasRule(".missing")).toBe(false);
  });

  it("inMedia() and forced() return the rules inside a media query, also in layers", () => {
    expect(css.inMedia("min-width: 600px").map((r) => r.selector)).toEqual([".grid"]);
    expect(css.forced().map((r) => r.selector)).toEqual([".button"]);
    expect(css.forced("none").map((r) => r.selector)).toEqual(["a:focus-visible"]);
    expect(css.inMedia("supports")).toEqual([]);
    expect(css.ruleText(css.forced())).toBe(".button { color: ButtonText; }");
  });

  it("at-rule filters match the whole condition, only in @media/@supports/@container", () => {
    const sheet = stylesheet(`
      @layer forced-colors { .l { a: b; } }
      @media (min-width: 6000px) { .big { a: b; } }
      @media (min-width: 600px) and (max-width: 900px) { .both { a: b; } }
      @media (min-width: 600px) { .exact { a: b; } }
      @supports selector(:popover-open) { .yes { a: b; } }
      @supports not selector(:popover-open) { .no { a: b; } }
      @container card (min-width: 600px) { .box { a: b; } }
    `);
    const names = (list: readonly CssRule[]) => list.map((r) => r.selector);
    expect(names(sheet.inMedia("min-width: 600px"))).toEqual([".exact"]);
    expect(names(sheet.inMedia("(min-width: 600px)"))).toEqual([".exact"]);
    expect(names(sheet.inMedia("(min-width: 600px) and (max-width: 900px)"))).toEqual([".both"]);
    expect(names(sheet.within("supports", "selector(:popover-open)"))).toEqual([".yes"]);
    expect(names(sheet.within("supports", "not selector(:popover-open)"))).toEqual([".no"]);
    expect(names(sheet.within("container", "card (min-width: 600px)"))).toEqual([".box"]);
    expect(sheet.rules(".l", { atRule: "forced-colors" })).toEqual([]);
    expect(sheet.rules(".l", { layer: "forced-colors" })).toHaveLength(1);
    expect(sheet.hasRule(".exact", "min-width: 6000px")).toBe(false);
  });

  it("ranks layers for the cascade: layer order first, unlayered last, then source order", () => {
    const sheet = stylesheet(`
      @layer a, b;
      .unlayered { x: 1; }
      @layer b { .in-b { x: 1; } }
      @layer a { .in-a { x: 1; } .in-a-later { x: 1; } }
    `);
    const get = (selector: string) => sheet.first(selector, { plain: true });
    expect(sheet.isLater(get(".in-b"), get(".in-a-later"))).toBe(true);
    expect(sheet.isLater(get(".in-a-later"), get(".in-a"))).toBe(true);
    expect(sheet.isLater(get(".in-a"), get(".in-b"))).toBe(false);
    expect(sheet.isLater(get(".unlayered"), get(".in-b"))).toBe(true);
    expect(sheet.earliest(sheet.all)?.selector).toBe(".in-a");
  });

  it("orders layers by first mention, blocks and statements alike, nested ones dotted", () => {
    const written = stylesheet("@layer b { .x { y: 1; } } @layer a, b; @layer c { .z { y: 1; } }");
    expect(written.layerOrder()).toEqual(["b", "a", "c"]);
    const nested = stylesheet(
      "@layer a, b; @layer b { @layer x { .p { q: 1; } } @layer w, x; } @layer a { @layer m { .r { q: 1; } } }",
    );
    expect(nested.layerOrder()).toEqual(["a", "a.m", "b", "b.x", "b.w"]);
    expect(nested.first(".p", { layer: "b.x", plain: true }).layer).toBe("b.x");
    const p = nested.first(".p", { plain: true });
    expect(nested.isLater(p, nested.first(".r", { plain: true }))).toBe(true);
    expect(stylesheet("@layer { .a { b: c; } }").layerOrder()).toEqual([]);
  });

  it("ranks a rule directly in a layer after the layer's nested layers", () => {
    const sheet = stylesheet("@layer o { .own { q: 1; } @layer i { .inner { q: 2; } } }");
    const own = sheet.first(".own");
    const inner = sheet.first(".inner");
    expect(own.order).toBeLessThan(inner.order);
    expect(sheet.isLater(own, inner)).toBe(true);
  });

  it("first() is the first rule in source order and throws when there is none", () => {
    const sheet = stylesheet(".a { x: 1; } .a { x: 2; } @media (print) { .a { x: 3; } }");
    expect(sheet.first(".a").body).toBe("x: 1;");
    expect(sheet.first(".a", { atRule: "print" }).body).toBe("x: 3;");
    expect(() => sheet.first(".b")).toThrow(/no rule/);
  });

  it("layerOrder() lists the declared layers first", () => {
    expect(css.layerOrder()).toEqual(["reset", "base", "components"]);
  });

  it("tokenBlocks() reads the light, dark and chosen-dark custom properties", () => {
    const sheet = stylesheet(`
      @layer tokens {
        :root { --bg: #ffffff; --target: 44px; color-scheme: light dark; }
        @media (prefers-color-scheme: dark) {
          ${MEDIA_SELECTOR} { --bg: #121316; }
        }
        ${ATTRIBUTE_SELECTOR} { color-scheme: dark; --bg: #121316; }
      }
      :root { --header-h: 3rem; }
    `);
    const blocks = sheet.tokenBlocks();
    // The blocks stay apart: the second :root is its own rule.
    expect(blocks.light.map(customProperties)).toEqual([
      { "--bg": "#ffffff", "--target": "44px" },
      { "--header-h": "3rem" },
    ]);
    expect(blocks.dark.map(customProperties)).toEqual([{ "--bg": "#121316" }]);
    expect(blocks.darkChosen.map(customProperties)).toEqual([{ "--bg": "#121316" }]);
    expect(colourTokens(customProperties(blocks.light[0] as CssRule))).toEqual({
      "--bg": "#ffffff",
    });
  });
});

// These read the file as it is on disk, whatever CSS_TEST_WRAP_LAYER says.
const onDisk = (name = "app.css") => stylesheet(readCssRaw(name));

describe("the real public/app.css", () => {
  const app = onDisk();

  /**
   * Selectors of the rules that are in no `@media`, found without the parser: lines at column 0
   * (the unlayered tail) or at indent 2 inside a column-0 `@layer name {` block, up to the one
   * ending in `{`. The file is formatted that way (`npm run fmt`).
   */
  function plainSelectors(): string[] {
    const found: string[] = [];
    let pending = "";
    let inLayer = false;
    for (const line of stripComments(readCssRaw()).split("\n")) {
      if (pending === "") {
        if (/^@layer .*\{$/.test(line)) inLayer = true;
        else if (line.startsWith("}")) inLayer = false;
        const start = inLayer ? /^ {2}[^\s}@]/ : /^[^\s}@]/;
        if (!start.test(line)) continue;
      }
      pending += ` ${line}`;
      if (line.trimEnd().endsWith("{")) {
        found.push(normalizeSelector(pending.trim().replace(/\{$/, "")));
        pending = "";
      }
    }
    return found;
  }

  /** Not inside any `@media`, `@supports` or other container but a layer. */
  const outsideContainers = (r: CssRule) => r.atRules.every((at) => at.startsWith("@layer "));

  it("has a plausible number of rules", () => {
    expect(app.all.length).toBeGreaterThan(250);
    expect(app.all.length).toBeLessThan(1000);
    expect(app.all.filter((r) => r.atRules.length > 0).length).toBeGreaterThan(30);
    expect(app.all.some((r) => r.selector.startsWith("@font-face"))).toBe(false);
  });

  it("finds every top-level selector of the file", () => {
    const expected = plainSelectors();
    expect(expected.length).toBeGreaterThan(200);
    const plain = new Set(app.all.filter(outsideContainers).map((r) => r.selector));
    expect(expected.filter((selector) => !plain.has(selector))).toEqual([]);
    expect(app.all.filter(outsideContainers)).toHaveLength(expected.length);
  });

  it("declares its layers once, first, in the documented order", () => {
    expect(app.statements.map((s) => s.text)).toEqual([
      "@layer tokens, base, components, layout, pages, forced-colors",
    ]);
    expect(app.layerOrder()).toEqual([
      "tokens",
      "base",
      "components",
      "layout",
      "pages",
      "forced-colors",
    ]);
    const first = app.all[0] as CssRule;
    expect(first.layer).toBe("tokens");
    expect(first.selector).toBe(":root");
  });

  it("keeps only map and Leaflet rules outside the layers, after every layered rule", () => {
    const unlayered = app.all.filter((r) => r.layer === undefined);
    expect(unlayered.length).toBeGreaterThan(10);
    // `.map` as a whole class name: `.map-tools` and `.map-caption` are layered on purpose.
    for (const rule of unlayered)
      expect(rule.selector).toMatch(/\.map(?![\w-])|leaflet|map-locate/);
    const lastLayered = Math.max(
      ...app.all.filter((r) => r.layer !== undefined).map((r) => r.order),
    );
    expect(Math.min(...unlayered.map((r) => r.order))).toBeGreaterThan(lastLayered);
  });

  it("lets the margin after a hint beat the base margin of the time and place pills", () => {
    // Both are in a layer now, so the layer order decides before the specificity: the `.hint +`
    // rule must come later in the cascade than `.when-where` (the admin plan page needs the gap).
    const base = app.first(".when-where", { plain: true });
    const afterHint = app.first(".hint + .when-where", { plain: true });
    expect(app.isLater(afterHint, base)).toBe(true);
  });

  it("keeps three forced-colours rules in components: they must lose to their state rules", () => {
    // In the last layer they would beat the focus, invalid and hover rules of the same component,
    // which they lose to in the flat cascade (specificity); that would change the look.
    const forcedIn = (layer: string) =>
      app.all.filter(
        (r) => r.layer === layer && r.atRules.at(-1) === "@media (forced-colors: active)",
      );
    const underline = app.rules(
      ':is(input:not([type]), input[type="text"], input[type="email"], input[type="url"], input[type="search"], input[type="number"], input[type="tel"], input[type="password"], textarea), :is(input[type="date"], input[type="time"], input[type="file"], .field select)',
      { atRule: "forced-colors: active", layer: "components" },
    );
    expect(underline.map((r) => r.body)).toEqual([
      expect.stringContaining("border-bottom-color: GrayText"),
    ]);
    expect(
      app.rules(".inline-input.line-action", {
        atRule: "forced-colors: active",
        layer: "components",
      }),
    ).toHaveLength(1);
    expect(
      app.rules(".point-readout p button.icon-button", {
        atRule: "forced-colors: active",
        layer: "components",
      }),
    ).toHaveLength(1);
    const last = forcedIn("forced-colors").map((r) => r.body);
    expect(last.length).toBeGreaterThan(0);
    for (const body of last) expect(body).not.toMatch(/border-bottom-color|ButtonText/);
  });

  it("puts the tokens in the tokens layer and the forced-colours blocks in the last layer", () => {
    const { light, dark, darkChosen } = app.tokenBlocks();
    for (const rule of [...light, ...dark, ...darkChosen]) expect(rule.layer).toBe("tokens");
    for (const rule of app.forced().filter((r) => r.layer === "forced-colors")) {
      expect(rule.atRules.at(-1)).toBe("@media (forced-colors: active)");
    }
    expect(app.rules(".logo", { layer: "forced-colors" }).length).toBeGreaterThan(0);
  });

  it("finds the three token blocks", () => {
    const { light, dark, darkChosen } = app.tokenBlocks();
    expect(colourTokens(customProperties(light[0] as CssRule))["--bg"]).toBeDefined();
    expect(colourTokens(customProperties(dark[0] as CssRule))["--bg"]).toBeDefined();
    expect(Object.keys(customProperties(darkChosen[0] as CssRule)).length).toBeGreaterThan(20);
  });

  it("parses the style guide's own stylesheet too", () => {
    expect(onDisk("styleguide.css").hasRule(".sg-section")).toBe(true);
  });
});

// The file has layers of its own now, so the copy is wrapped one level further out: its layers
// become `shell.tokens` and so on, its unlayered tail becomes `shell` itself.
describe("a copy of public/app.css wrapped in one more layer", () => {
  const real = onDisk();
  const layered = stylesheet(wrapInLayer(normalizeCss(readCssRaw()), "shell"));

  it("has the same rules, all inside the outer layer", () => {
    expect(layered.all.map((r) => r.selector)).toEqual(real.all.map((r) => r.selector));
    expect(layered.all.every((r) => r.layer === "shell" || r.layer?.startsWith("shell."))).toBe(
      true,
    );
    expect(layered.layerOrder()).toEqual([
      "shell",
      ...real.layerOrder().map((name) => `shell.${name}`),
    ]);
  });

  it("answers rule() like the real file, for a plain rule and for the :root blocks", () => {
    expect(layered.rule(".icon-search")).toBe(real.rule(".icon-search"));
    expect(layered.rule(".icon-search")).toContain('--icon: url("icons/search.svg")');
    const props = (sheet: typeof real) => {
      const { light, dark, darkChosen } = sheet.tokenBlocks();
      return [light, dark, darkChosen].map((list) => list.map(customProperties));
    };
    expect(props(layered)).toEqual(props(real));
  });

  it("answers forced-colors queries like the real file", () => {
    const selector = ".inline-input.line-action button.line-action-button";
    expect(layered.rule(selector, { atRule: "forced-colors: active" })).toBe(
      real.rule(selector, { atRule: "forced-colors: active" }),
    );
    expect(layered.rule(selector, { atRule: "forced-colors: active" })).toMatch(
      /color: ButtonText/,
    );
    expect(layered.ruleText(layered.forced())).toBe(real.ruleText(real.forced()));
    expect(layered.ruleText(layered.forced("none"))).toBe(real.ruleText(real.forced("none")));
    expect(layered.forced("none").length).toBeGreaterThan(0);
  });

  it("selects by layer name", () => {
    expect(layered.rules(".icon-search", { layer: "shell.components" })).toHaveLength(1);
    expect(layered.rules(".icon-search", { layer: "components" })).toHaveLength(0);
    expect(real.rules(".icon-search", { layer: "components" })).toHaveLength(1);
    expect(real.rules(".icon-search", { layer: "shell.components" })).toHaveLength(0);
  });
});
