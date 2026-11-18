// A CSS helper for the tests that guard `public/app.css` (and `public/styleguide.css`).
//
// The old tests matched rules with regular expressions that assumed top-level rules; a rule inside
// `@layer name { ... }` was invisible to them. This helper reads a stylesheet, parses it with a
// small tolerant scanner and answers questions in terms of rules, so wrapping blocks in `@layer`
// or `@media` does not change what a test sees.
//
// API
//   readCss(name = "app.css")        the file, comments stripped, quotes `"` and whitespace single
//   readCssRaw(name = "app.css")     the file as it is on disk (comments included)
//   stylesheet(text)                 a `Stylesheet` over normalised CSS text (any text, e.g. a copy)
//   loadStylesheet(name = "app.css") the same for a file in public/, cached
//   wrapInLayer(text, layer)         the text inside `@layer layer { ... }` (in memory)
//   CSS_TEST_WRAP_LAYER=name         env var: `readCss` (so `loadStylesheet` and every test) gets the
//                                    file wrapped in `@layer name { ... }` in memory, to prove that
//                                    the tests do not depend on where a rule lives
//   parseCss(text)                   `{ rules, statements }`: the flat result of the scan
//   normalizeSelector / splitSelectorList / declarations   the building blocks
//
// A `Stylesheet` offers `text`, `all` (every rule in source order), `statements`, `rules`, `rule`,
// `first`, `hasRule`, `within`, `inMedia`, `forced`, `ruleText`, `tokenBlocks`, `layerOrder`,
// `cascadeIndex`, `isLater` and `earliest`. A rule is
// `{ selector, body, atRules, layer, order }`:
//   selector  the selector list, normalised (`a,b` and `a , b` are `a, b`; combinators are
//             surrounded by single spaces; text in strings and `[...]` is left alone). For
//             `@font-face` and `@keyframes x` it is the at-rule's prelude text.
//   body      the text between the braces, trimmed
//   atRules   the enclosing container preludes, outermost first, e.g. ["@layer components",
//             "@media (forced-colors: active)"]
//   layer     the name of the nearest enclosing `@layer` (dotted when nested: `outer.inner`), or
//             undefined
//   order     the index in source order. Across layers the cascade does not follow it: the layer
//             order decides first. Use `cascadeIndex`/`isLater` for "comes later in the cascade".
//
// At-rule filters (`atRule`, `within`, `inMedia`, `forced`) look at `@media`, `@supports` and
// `@container` preludes only, and match the whole condition: `min-width: 600px` is
// `@media (min-width: 600px)` but neither `(min-width: 6000px)` nor a compound query, and
// `selector(:popover-open)` is not `not selector(:popover-open)`. Layers are chosen with `layer`.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PUBLIC = join(import.meta.dirname, "../../public");

/** Blocks that hold other rules and are walked into. Everything else with a block is its own rule. */
const CONTAINERS = new Set(["media", "supports", "container", "layer", "scope", "document"]);

export type CssRule = {
  readonly selector: string;
  readonly body: string;
  readonly atRules: readonly string[];
  readonly layer: string | undefined;
  readonly order: number;
};

/** A statement at-rule without a block, such as `@layer a, b;` or `@import url(x);`. */
export type CssStatement = {
  readonly text: string;
  readonly atRules: readonly string[];
  readonly layer: string | undefined;
};

export type Declaration = { readonly property: string; readonly value: string };

export type RuleFilter = {
  /** Keep rules inside an at-rule whose prelude contains this text, e.g. `forced-colors: active`. */
  readonly atRule?: string;
  /** Keep rules whose nearest enclosing `@layer` has exactly this name. */
  readonly layer?: string;
  /** true: only rules outside every `@media`/`@supports`/`@container` (layers do not count). */
  readonly plain?: boolean;
  /** Compare selector lists as sets: `a, b` matches `b, a`. */
  readonly anyOrder?: boolean;
};

/** Comments removed (not inside strings), each replaced by one space. */
export function stripComments(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const ch = css.charAt(i);
    if (ch === "/" && css.charAt(i + 1) === "*") {
      const end = css.indexOf("*/", i + 2);
      out += " ";
      i = end === -1 ? css.length : end + 2;
    } else if (ch === '"' || ch === "'") {
      const end = skipString(css, i);
      out += css.slice(i, end);
      i = end;
    } else if (ch === "\\") {
      out += css.slice(i, i + 2);
      i += 2;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/** The index just after the string that starts at `start` (an escape or end of text is tolerated). */
function skipString(text: string, start: number): number {
  const quote = text.charAt(start);
  let i = start + 1;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (ch === "\\") i += 2;
    else if (ch === quote) return i + 1;
    else i += 1;
  }
  return text.length;
}

/**
 * `'...'` strings written as `"..."` (an inner `"` is escaped, `\'` loses its backslash); text in
 * double-quoted strings, such as an apostrophe, is left alone.
 */
export function normalizeQuotes(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const ch = css.charAt(i);
    if (ch === "'") {
      const end = skipString(css, i);
      const inner = css.slice(i + 1, css.charAt(end - 1) === "'" ? end - 1 : end);
      out += `"${inner.replace(/\\(.)|"/g, (_m, escaped: string | undefined) => (escaped === undefined ? '\\"' : escaped === "'" ? "'" : `\\${escaped}`))}"`;
      i = end;
    } else if (ch === '"') {
      const end = skipString(css, i);
      out += css.slice(i, end);
      i = end;
    } else if (ch === "\\") {
      out += css.slice(i, i + 2);
      i += 2;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/** Comments gone, strings double-quoted, every run of whitespace one space. */
export function normalizeCss(raw: string): string {
  return normalizeQuotes(stripComments(raw)).replace(/\s+/g, " ");
}

export function readCssRaw(name = "app.css"): string {
  return readFileSync(join(PUBLIC, name), "utf8");
}

/**
 * The stylesheet in public/ without comments, with one space for any whitespace, `"` only. With
 * the env var `CSS_TEST_WRAP_LAYER` set, the text is wrapped in that `@layer` (in memory).
 */
export function readCss(name = "app.css"): string {
  const text = normalizeCss(readCssRaw(name));
  const layer = process.env["CSS_TEST_WRAP_LAYER"];
  return layer === undefined || layer === "" ? text : wrapInLayer(text, layer);
}

/** The text inside one `@layer` block, for tests that must not care where a rule lives. */
export function wrapInLayer(css: string, layer: string): string {
  return `@layer ${layer} { ${css} }`;
}

// A scan position moves over text in which strings, `(...)`, `[...]`, escapes and comments hide
// the characters `{`, `}` and `;`.

type Stop = { readonly index: number; readonly char: "{" | "}" | ";" | "" };

/** The first `{`, `}` or `;` at nesting depth 0 from `from`, or the end of the range. */
function scanPrelude(text: string, from: number, to: number): Stop {
  let depth = 0;
  let i = from;
  while (i < to) {
    const ch = text.charAt(i);
    if (ch === "\\") i += 2;
    else if (ch === '"' || ch === "'") i = skipString(text, i);
    else if (ch === "/" && text.charAt(i + 1) === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? to : end + 2;
    } else if (ch === "(" || ch === "[") {
      depth += 1;
      i += 1;
    } else if (ch === ")" || ch === "]") {
      depth = Math.max(0, depth - 1);
      i += 1;
    } else if (depth === 0 && (ch === "{" || ch === "}" || ch === ";")) {
      return { index: i, char: ch };
    } else i += 1;
  }
  return { index: to, char: "" };
}

/** The index of the `}` that closes the `{` at `open`, or `to` if it is never closed. */
function findClose(text: string, open: number, to: number): number {
  let braces = 1;
  let i = open + 1;
  while (i < to) {
    const stop = scanPrelude(text, i, to);
    if (stop.char === "{") braces += 1;
    else if (stop.char === "}") {
      braces -= 1;
      if (braces === 0) return stop.index;
    } else if (stop.char === "") return to;
    i = stop.index + 1;
  }
  return to;
}

const squeeze = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * Selector text in one form: whitespace collapsed, `, ` between list items (also inside
 * `:is()`/`:where()`), single spaces around `>`, `+` and `~`, none inside parentheses. Strings and
 * `[...]` are copied unchanged, so `[a~="x"]` and `[title="a, b"]` survive.
 */
export function normalizeSelector(selector: string): string {
  let out = "";
  let skipSpace = true;
  let i = 0;
  const trimEnd = () => {
    out = out.replace(/ $/, "");
  };
  while (i < selector.length) {
    const ch = selector.charAt(i);
    if (ch === "\\") {
      out += selector.slice(i, i + 2);
      i += 2;
      skipSpace = false;
    } else if (ch === '"' || ch === "'") {
      const end = skipString(selector, i);
      out += selector.slice(i, end);
      i = end;
      skipSpace = false;
    } else if (ch === "[") {
      let end = i + 1;
      while (end < selector.length && selector.charAt(end) !== "]") {
        const c = selector.charAt(end);
        end = c === '"' || c === "'" ? skipString(selector, end) : end + 1;
      }
      out += selector.slice(i, end + 1);
      i = end + 1;
      skipSpace = false;
    } else if (/\s/.test(ch)) {
      if (!skipSpace) out += " ";
      skipSpace = true;
      i += 1;
    } else if (ch === ",") {
      trimEnd();
      out += ", ";
      skipSpace = true;
      i += 1;
    } else if (ch === ">" || ch === "+" || ch === "~") {
      trimEnd();
      out += ` ${ch} `;
      skipSpace = true;
      i += 1;
    } else if (ch === "(") {
      out += ch;
      skipSpace = true;
      i += 1;
    } else if (ch === ")") {
      trimEnd();
      out += ch;
      skipSpace = false;
      i += 1;
    } else {
      out += ch;
      skipSpace = false;
      i += 1;
    }
  }
  return out.trim();
}

/** The items of a selector list, split at commas outside parentheses, brackets and strings. */
export function splitSelectorList(selector: string): string[] {
  const items: string[] = [];
  let start = 0;
  let depth = 0;
  let i = 0;
  while (i < selector.length) {
    const ch = selector.charAt(i);
    if (ch === "\\") i += 2;
    else if (ch === '"' || ch === "'") i = skipString(selector, i);
    else {
      if (ch === "(" || ch === "[") depth += 1;
      else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
      else if (ch === "," && depth === 0) {
        items.push(selector.slice(start, i).trim());
        start = i + 1;
      }
      i += 1;
    }
  }
  items.push(selector.slice(start).trim());
  return items.filter((item) => item !== "");
}

/** The property/value pairs of a rule body; `;` inside parentheses or strings does not split. */
export function declarations(body: string): Declaration[] {
  const out: Declaration[] = [];
  let start = 0;
  const push = (end: number) => {
    const part = body.slice(start, end);
    const colon = scanColon(part);
    if (colon > 0) {
      out.push({ property: part.slice(0, colon).trim(), value: squeeze(part.slice(colon + 1)) });
    }
  };
  while (start < body.length) {
    const stop = scanPrelude(body, start, body.length);
    if (stop.char === "}" || stop.char === "{") {
      // A nested rule or a stray brace: not a declaration; skip to what follows it.
      const close = stop.char === "{" ? findClose(body, stop.index, body.length) : stop.index;
      start = close + 1;
      continue;
    }
    push(stop.index);
    start = stop.index + 1;
  }
  return out;
}

/** The index of the first `:` outside strings and parentheses, or -1. */
function scanColon(text: string): number {
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (ch === "\\") i += 2;
    else if (ch === '"' || ch === "'") i = skipString(text, i);
    else {
      if (ch === "(" || ch === "[") depth += 1;
      else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
      else if (ch === ":" && depth === 0) return i;
      i += 1;
    }
  }
  return -1;
}

export type Parsed = {
  readonly rules: CssRule[];
  readonly statements: CssStatement[];
  /** Every layer name in order of first mention (block or statement); nested ones are dotted. */
  readonly layers: string[];
};

/**
 * Walks a stylesheet and returns its rules as one flat list, in source order. `@media`,
 * `@supports`, `@container`, `@scope` and `@layer name { }` are containers; `@layer a, b;` and
 * `@import` are statements; other at-rules with a block (`@font-face`, `@keyframes`, `@property`)
 * are rules of their own whose selector is the prelude. Unclosed blocks and stray braces are
 * tolerated rather than thrown at.
 */
export function parseCss(css: string): Parsed {
  const text = normalizeQuotes(stripComments(css));
  const rules: CssRule[] = [];
  const statements: CssStatement[] = [];
  const layers: string[] = [];
  const mention = (name: string) => {
    if (!layers.includes(name)) layers.push(name);
  };

  const walk = (
    from: number,
    to: number,
    atRules: readonly string[],
    layer: string | undefined,
  ): void => {
    let i = from;
    while (i < to) {
      const stop = scanPrelude(text, i, to);
      const prelude = squeeze(text.slice(i, stop.index));
      if (stop.char !== "{") {
        if (prelude.startsWith("@")) {
          statements.push({ text: prelude, atRules, layer });
          if (/^@layer\s/.test(prelude)) {
            for (const name of prelude.slice("@layer".length).split(",").map(squeeze)) {
              if (name !== "") mention(layer === undefined ? name : `${layer}.${name}`);
            }
          }
        }
        i = stop.index + 1;
        continue;
      }
      const close = findClose(text, stop.index, to);
      const keyword = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase();
      if (keyword !== undefined && CONTAINERS.has(keyword)) {
        const name = keyword === "layer" ? squeeze(prelude.slice("@layer".length)) : undefined;
        const nested = layer === undefined ? name : `${layer}.${name}`;
        const nextLayer = keyword === "layer" ? (name === "" ? undefined : nested) : layer;
        if (keyword === "layer" && nextLayer !== undefined) mention(nextLayer);
        walk(stop.index + 1, close, [...atRules, prelude], nextLayer);
      } else {
        const body = text.slice(stop.index + 1, close).trim();
        const selector = keyword === undefined ? normalizeSelector(prelude) : prelude;
        rules.push({ selector, body, atRules, layer, order: rules.length });
      }
      i = close + 1;
    }
  };
  walk(0, text.length, [], undefined);
  return { rules, statements, layers };
}

const sortedKey = (selector: string) =>
  splitSelectorList(normalizeSelector(selector)).sort().join();

const CONDITION_KINDS = ["media", "supports", "container"] as const;
type ConditionKind = (typeof CONDITION_KINDS)[number];

/** Does this prelude (`@media (min-width: 600px)`) state exactly `wanted` (with or without parentheses)? */
function matchesPrelude(prelude: string, kind: ConditionKind, wanted: string): boolean {
  if (!prelude.startsWith(`@${kind} `) && !prelude.startsWith(`@${kind}(`)) return false;
  const condition = squeeze(prelude.slice(kind.length + 1));
  return condition === wanted || condition === `(${wanted})`;
}

function inside(rule: CssRule, text: string, kinds: readonly ConditionKind[] = CONDITION_KINDS) {
  const wanted = squeeze(text);
  return rule.atRules.some((atRule) => kinds.some((kind) => matchesPrelude(atRule, kind, wanted)));
}

const isPlain = (rule: CssRule) => rule.atRules.every((atRule) => atRule.startsWith("@layer"));

/** `selector { body }` per rule, joined with a space: a stand-in for text regexes on a block. */
export function ruleText(list: readonly CssRule[]): string {
  return list.map((r) => `${r.selector} { ${terminated(r.body)} }`).join(" ");
}

/** One rule's declarations as `property: value;` text, for text matching. */
export function bodyText(rule: CssRule): string {
  return terminated(rule.body).replace(/\s*:\s*/g, ": ");
}

function terminated(body: string): string {
  const text = squeeze(body);
  return text === "" || text.endsWith(";") ? text : `${text};`;
}

export type TokenBlocks = {
  /** The `:root` rules, in source order. */
  readonly light: readonly CssRule[];
  /** The `:root:not([data-theme="light"])` rules inside `@media (prefers-color-scheme: dark)`. */
  readonly dark: readonly CssRule[];
  /** The `:root[data-theme="dark"]` rules (dark chosen, decision I82). */
  readonly darkChosen: readonly CssRule[];
};

/** The custom properties (`--name`) a rule declares. */
export function customProperties(rule: CssRule): Record<string, string> {
  return Object.fromEntries(
    declarations(rule.body)
      .filter(({ property }) => property.startsWith("--"))
      .map(({ property, value }) => [property, value]),
  );
}

export const DARK_MEDIA = "prefers-color-scheme: dark";
export const MEDIA_SELECTOR = ':root:not([data-theme="light"])';
export const ATTRIBUTE_SELECTOR = ':root[data-theme="dark"]';

export class Stylesheet {
  readonly text: string;
  readonly all: readonly CssRule[];
  readonly statements: readonly CssStatement[];
  private readonly mentioned: readonly string[];

  constructor(text: string) {
    this.text = text;
    const parsed = parseCss(text);
    this.all = parsed.rules;
    this.statements = parsed.statements;
    this.mentioned = parsed.layers;
  }

  /**
   * Every rule whose selector list is exactly `selector` (after normalising). Without a filter
   * this includes copies inside `@media` and the like; narrow with `atRule`, `layer`, `plain`.
   */
  rules(selector: string, filter: RuleFilter = {}): CssRule[] {
    const wanted = filter.anyOrder === true ? sortedKey(selector) : normalizeSelector(selector);
    return this.all.filter((rule) => {
      const same =
        filter.anyOrder === true ? sortedKey(rule.selector) === wanted : rule.selector === wanted;
      return (
        same &&
        (filter.atRule === undefined || inside(rule, filter.atRule)) &&
        (filter.layer === undefined || rule.layer === filter.layer) &&
        (filter.plain !== true || isPlain(rule))
      );
    });
  }

  /**
   * The declarations of every matching rule, joined (`property: value;`), asserting that there is
   * at least one rule. By default only rules outside `@media`/`@supports`/`@container` count (a
   * layer does not), so a media copy is not mixed in; give `atRule` or `plain: false` to ask for
   * those.
   */
  rule(selector: string, filter: RuleFilter = {}): string {
    const plain = filter.plain ?? filter.atRule === undefined;
    const found = this.rules(selector, { ...filter, plain });
    if (found.length === 0) {
      const where = filter.atRule === undefined ? "" : ` in "${filter.atRule}"`;
      throw new Error(`no rule for "${selector}"${where}`);
    }
    return found
      .map((rule) => terminated(rule.body))
      .join(" ")
      .replace(/\s*:\s*/g, ": ");
  }

  /** The first matching rule in source order (the one a test used to read); throws if none. */
  first(selector: string, filter: RuleFilter = {}): CssRule {
    const plain = filter.plain ?? filter.atRule === undefined;
    const found = this.rules(selector, { ...filter, plain })[0];
    if (found === undefined) throw new Error(`no rule for "${selector}"`);
    return found;
  }

  /**
   * The position of a rule's layer in the declared order; unlayered rules rank last. Rules that sit
   * directly in a layer that also has nested layers (`outer` next to `outer.inner`) come after
   * the nested ones, as the CSS cascade has it: they are that layer's own, unlayered-in-it rules.
   */
  layerRank(rule: CssRule): number {
    const order = this.layerOrder();
    const index = rule.layer === undefined ? -1 : order.indexOf(rule.layer);
    if (index === -1) return order.length;
    const prefix = `${rule.layer}.`;
    const lastNested = order.findLastIndex((name) => name.startsWith(prefix));
    return lastNested === -1 ? index : lastNested + 0.5;
  }

  /** A number that grows along the cascade: the layer's rank first, then the source order. */
  cascadeIndex(rule: CssRule): number {
    return this.layerRank(rule) * (this.all.length + 1) + rule.order;
  }

  /** Does `a` come after `b` in the cascade (layer rank first, then source order)? */
  isLater(a: CssRule, b: CssRule): boolean {
    return this.cascadeIndex(a) > this.cascadeIndex(b);
  }

  /** The rule of the list that comes first in the cascade. */
  earliest(list: readonly CssRule[]): CssRule | undefined {
    return [...list].sort((a, b) => this.cascadeIndex(a) - this.cascadeIndex(b))[0];
  }

  /** Is there a rule for exactly this selector list, anywhere or inside the given at-rule text? */
  hasRule(selector: string, atRule?: string): boolean {
    return this.rules(selector, atRule === undefined ? {} : { atRule }).length > 0;
  }

  /** The rules inside an `@kind` whose condition is exactly `text`, e.g. `("supports", "selector(:popover-open)")`. */
  within(kind: ConditionKind, text: string): CssRule[] {
    return this.all.filter((rule) => inside(rule, text, [kind]));
  }

  /** The rules inside an `@media` whose whole query is `query`, e.g. `min-width: 600px`. */
  inMedia(query: string): CssRule[] {
    return this.within("media", query);
  }

  /** The rules inside `@media (forced-colors: active)` (or `none`). */
  forced(mode: "active" | "none" = "active"): CssRule[] {
    return this.inMedia(`forced-colors: ${mode}`);
  }

  ruleText(list: readonly CssRule[]): string {
    return ruleText(list);
  }

  /**
   * The layer names from the weakest to the strongest layer, as CSS orders them: by first mention
   * in source order (a block mentions its name where it stands, a statement each name where it
   * stands). Nested layers are dotted (`b.x`) and sort right after their parent's position.
   */
  layerOrder(): string[] {
    const position = (name: string) => this.mentioned.indexOf(name);
    // Compare along the path: first by the parent chain's mention order, then by the name itself.
    const key = (name: string): number[] => {
      const parts = name.split(".");
      return parts.map((_part, i) => position(parts.slice(0, i + 1).join(".")));
    };
    return [...this.mentioned].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      for (let i = 0; i < Math.min(ka.length, kb.length); i++) {
        const diff = (ka[i] ?? 0) - (kb[i] ?? 0);
        if (diff !== 0) return diff;
      }
      return ka.length - kb.length;
    });
  }

  /** The rules of the three colour scheme blocks, kept apart, see `TokenBlocks`. */
  tokenBlocks(): TokenBlocks {
    return {
      light: this.rules(":root", { plain: true }),
      dark: this.rules(MEDIA_SELECTOR, { atRule: DARK_MEDIA }),
      darkChosen: this.rules(ATTRIBUTE_SELECTOR, { plain: true }),
    };
  }
}

/** A stylesheet over CSS text; the text is normalised the way `readCss` does it. */
export function stylesheet(text: string): Stylesheet {
  return new Stylesheet(normalizeCss(text));
}

const loaded = new Map<string, Stylesheet>();

/** The stylesheet `name` from public/, read and parsed once per test file. */
export function loadStylesheet(name = "app.css"): Stylesheet {
  let sheet = loaded.get(name);
  if (sheet === undefined) {
    sheet = new Stylesheet(readCss(name));
    loaded.set(name, sheet);
  }
  return sheet;
}

/** The colour tokens (`#rrggbb` values only) of a block from `tokenBlocks()`. */
export function colourTokens(block: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(block).filter(([, v]) => /^#[0-9a-f]{6}$/i.test(v)));
}
