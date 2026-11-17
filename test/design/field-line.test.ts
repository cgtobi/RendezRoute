// Guards for the one field style, the line (decision D73, plan I90): text-like fields are an
// underline instead of a box, and an empty required text, file or select field shows a red
// "Required" hint made by CSS alone (date and time only after a failed submit, D74). Also the
// placeholder grey and the disabled look (D74, I91). The pixel result is checked by
// e2e/field-style.spec.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const SOURCE = readFileSync(join(import.meta.dirname, "../../public/app.css"), "utf8");

/** The stylesheet without comments, with one space for any whitespace and double quotes only. */
const CSS = SOURCE.replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/'/g, '"')
  .replace(/\s+/g, " ");

/** The part of the stylesheet that is not inside a media or supports block. */
const TOP_LEVEL = CSS.replace(/@(?:media|supports)[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, " ");

/** Selector text with comma lists collapsed: `a,b` and `a, b` are the same. */
const normal = (selector: string) =>
  selector
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s*([>+~])\s*/g, " $1 ")
    .trim();

/** The declarations of every top-level rule whose selector text is exactly this one, joined. */
function rule(selector: string, from: string = TOP_LEVEL): string {
  const found: string[] = [];
  for (const match of from.matchAll(/(?<=^|[};])\s*([^{}@;][^{}]*)\{([^{}]*)\}/g)) {
    if (normal(match[1] ?? "") === normal(selector)) found.push(match[2] ?? "");
  }
  expect(found.length, `no rule for "${selector}" in public/app.css`).toBeGreaterThan(0);
  return found.join(" ").replace(/\s*:\s*/g, ": ");
}

const TEXT_LIKE =
  ':is(input:not([type]), input[type="text"], input[type="email"], input[type="url"], input[type="search"], input[type="number"], input[type="tel"], input[type="password"], textarea)';
const LINE_OTHERS =
  ':is(input[type="date"], input[type="time"], input[type="file"], .field select)';
const LINES = `${TEXT_LIKE}, ${LINE_OTHERS}`;
const FILE_SELECT = ':is(input[type="file"], select)';
const EDITABLE = ":not(:disabled, [readonly])";
const DISABLED_STATE = ":is(:disabled, [readonly])";
const LINES_DISABLED = `${TEXT_LIKE}${DISABLED_STATE}, ${LINE_OTHERS}${DISABLED_STATE}`;
const LINES_DISABLED_FOCUS = `${TEXT_LIKE}${DISABLED_STATE}:focus, ${LINE_OTHERS}${DISABLED_STATE}:focus`;
const forcedCss = [...CSS.matchAll(/@media \(forced-colors: active\) \{(.*?)\} \}/g)]
  .map((match) => match[1] ?? "")
  .join(" ");

describe("the line field rule (decision D73)", () => {
  it("covers text, email, url, search, number, tel, password, untyped inputs and textarea", () => {
    for (const type of ["text", "email", "url", "search", "number", "tel", "password"]) {
      expect(TEXT_LIKE).toContain(`input[type="${type}"]`);
    }
    expect(TEXT_LIKE).not.toMatch(/radio|checkbox|color|file|date|time|select/);
    expect(rule(LINES)).toMatch(/border-width: 0 0 1px/);
  });

  it("is an underline: only a 1 px bottom border, transparent background, no radius", () => {
    const body = rule(LINES);
    expect(body).toMatch(/border-style: solid/);
    expect(body).toMatch(/border-width: 0 0 1px/);
    expect(body).toMatch(/border-color: transparent transparent var\(--field-border\)/);
    expect(body).toMatch(/background-color: transparent/);
    expect(body).toMatch(/border-radius: 0(?![.\d])/);
    expect(body).not.toMatch(/(?<![-\w])background: /);
  });

  it("keeps the 44 px target with min-height and padding, not with the border", () => {
    const generic = rule(
      'input:not([type="radio"], [type="checkbox"], [type="color"]), select, textarea',
    );
    expect(generic).toMatch(/min-height: var\(--target\)/);
    expect(rule(LINES)).toMatch(/padding-block: var\(--s2\)/);
  });

  it("reserves no padding at the end of the text: there is no pencil", () => {
    expect(rule(TEXT_LIKE)).not.toMatch(/padding-right/);
    expect(rule(LINES)).not.toMatch(/padding-right/);
    expect(CSS).not.toMatch(/pencil|line-pen|line-field|title-edit/);
  });

  it("underlines 2 px in the accent colour on focus", () => {
    const focus = rule(`${TEXT_LIKE}:focus, ${LINE_OTHERS}:focus`);
    expect(focus).toMatch(/border-bottom-width: 2px/);
    expect(focus).toMatch(/border-bottom-color: var\(--accent\)/);
    expect(focus).not.toMatch(/outline/);
    // The global ring stays for everything that is not a text-like line field.
    expect(CSS).toMatch(/ :focus-visible \{[^}]*outline: 3px/);
  });

  it("shows no browser frame on a focused text-like line field, only in forced colours", () => {
    const none =
      /@media \(forced-colors: none\) \{ ([^{]*:focus-visible:not\([^)]*\)[^{]*)\{ outline: none; \} \}/.exec(
        CSS,
      );
    // The removal sits inside forced-colors: none: it outranks the Highlight rule otherwise.
    expect(none).not.toBeNull();
    expect(none?.[1]).toContain('input[type="text"]');
    // The danger line outranks the accent one there, so those two states keep the global ring;
    // a read-only field has no focus underline either.
    expect(none?.[1]).toContain(
      ":focus-visible:not(:placeholder-shown:required, .field-invalid *, [readonly])",
    );
    expect(TOP_LEVEL).not.toMatch(/:focus-visible:not\([^)]*\) \{ outline: none/);
    expect(CSS).toMatch(/:focus-visible \{\s*outline: 2px solid Highlight;/);
    // Date, time, file and select fields keep the global ring: none of them is in that rule.
    expect(TEXT_LIKE).not.toMatch(/date|time|file|select/);
  });

  it("underlines 2 px in the danger colour on an error and on an empty required field", () => {
    const body = rule(
      [
        `.field-invalid ${TEXT_LIKE}`,
        `.field-invalid ${LINE_OTHERS}`,
        `${TEXT_LIKE}:required:placeholder-shown${EDITABLE}`,
        `${LINE_OTHERS}:required:invalid${EDITABLE}`,
      ].join(", "),
    );
    expect(body).toMatch(/border-bottom-color: var\(--danger\)/);
    expect(body).toMatch(/border-bottom-width: 2px/);
  });

  it("uses tokens only: no raw colour in the line rules", () => {
    const start = CSS.indexOf("input::placeholder");
    const end = CSS.indexOf("/* Messages */") > 0 ? CSS.indexOf(".warning {") : CSS.length;
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const block = CSS.slice(start, end);
    // System colours are allowed in the forced-colours block only.
    expect(block.replace(/@media \(forced-colors: active\).*$/, "")).not.toMatch(
      /#[0-9a-f]{3,8}\b|rgba?\(|hsl|(?:Canvas|GrayText|Highlight)/i,
    );
  });

  it("limits selects to the .field ones, so the menu's preference select is unchanged", () => {
    expect(LINE_OTHERS).toContain(".field select");
    expect(CSS).not.toMatch(/\.preference :is|\.preference select \{[^}]*border-width: 0/);
  });

  it("keeps the select's arrow: the line rules never set a background shorthand or image", () => {
    expect(rule("select")).toMatch(/background-image: linear-gradient/);
    expect(rule("select")).toMatch(/padding-right: calc\(var\(--s3\) \+ 1\.75rem\)/);
    expect(rule(LINES)).not.toMatch(/background-image|(?<![-\w])background: /);
  });

  it("keeps the date and time rules from the WebKit fix", () => {
    const body = rule('input[type="date"], input[type="time"]');
    expect(body).toMatch(/-webkit-appearance: none/);
    expect(body).toMatch(/(?<![-\w])appearance: none/);
  });

  it("makes the title the large variant of the same rule", () => {
    const title = rule(".plan-form .title-input");
    expect(title).toMatch(/font-size: calc\(var\(--text-2xl\) \* 0\.8\)/);
    expect(title).toMatch(/font-weight: 700/);
    expect(title).not.toMatch(/border|background|padding/);
    expect(CSS).not.toMatch(/\.title-input:hover/);
  });

  it("has forced-colours fallbacks with system colours for rest, focus and error", () => {
    expect(forcedCss).toMatch(/border-bottom-color: GrayText/);
    expect(forcedCss).toMatch(/border-bottom-color: Highlight/);
    expect(forcedCss).toMatch(/\.required-hint \{ color: CanvasText/);
  });
});

describe("the required hint (decision D73)", () => {
  it("is hidden unless a rule below shows it, and is danger-coloured, small and bold", () => {
    const body = rule(".required-hint");
    expect(body).toMatch(/display: none/);
    expect(body).toMatch(/color: var\(--danger\)/);
    expect(body).toMatch(/font-size: var\(--text-sm\)/);
    expect(body).toMatch(/font-weight: 600/);
  });

  it("shows under an empty required text field, by its shown placeholder", () => {
    const body = rule(`:where(:required:placeholder-shown${EDITABLE}) ~ .required-hint`);
    expect(body).toMatch(/display: block/);
  });

  it("shows under an invalid required file or select, but not under date or time (D74)", () => {
    const body = rule(`:where(${FILE_SELECT}:required:invalid${EDITABLE}) ~ .required-hint`);
    expect(body).toMatch(/display: block/);
    // A fresh form shows no hint under date and time; the error text comes after a failed submit.
    expect(CSS).not.toMatch(/\[type="(?:date|time)"\][^{}]*:required:invalid\)? ~ \.required-hint/);
    expect(CSS).not.toMatch(/:where\([^{}]*type="(?:date|time)"[^{}]*\) ~ \.required-hint/);
  });

  it("is shown only by rules that come after the hiding one and are lower than .field-invalid", () => {
    const hidden = CSS.indexOf(".required-hint { display: none");
    const shown = CSS.indexOf(":where(:required:placeholder-shown");
    const invalid = CSS.indexOf(".field-invalid .required-hint");
    expect(hidden).toBeGreaterThan(0);
    expect(shown).toBeGreaterThan(hidden);
    expect(invalid).toBeGreaterThan(shown);
    expect(rule(".field-invalid .required-hint")).toMatch(/display: none/);
    // `:where()` wraps every condition, so the shown rules weigh one class like the base rule.
    expect(CSS).not.toMatch(/(?<!:where\()\S*:required:placeholder-shown \+ \.required-hint/);
  });

  it("neither the red line nor the hint applies to a disabled or readonly control", () => {
    // Every rule that draws the required line or shows the hint excludes disabled and readonly.
    const required = [...TOP_LEVEL.matchAll(/(?<=^|[};])\s*([^{}@;][^{}]*)\{[^{}]*\}/g)]
      .map((match) => match[1] ?? "")
      .filter((selector) => /:required:(?:placeholder-shown|invalid)/.test(selector));
    expect(required.length).toBeGreaterThanOrEqual(3);
    for (const selector of required) {
      const withoutException = selector.replace(/:not\(\s*:disabled, \[readonly\]\s*\)/g, "");
      const count = (selector.match(/:required:(?:placeholder-shown|invalid)/g) ?? []).length;
      const excluded = (selector.match(/:not\(\s*:disabled, \[readonly\]\s*\)/g) ?? []).length;
      expect([selector, excluded]).toEqual([selector, count]);
      expect(withoutException).toMatch(/:required:/);
    }
  });

  it("works without script: selectors only, no class set by a script", () => {
    expect(SOURCE).not.toMatch(/required-hint-visible|is-empty/);
  });
});

describe("the placeholder grey (decision D74)", () => {
  it("colours placeholders with --placeholder at full opacity, not with --muted", () => {
    const body = rule("input::placeholder, textarea::placeholder");
    expect(body).toMatch(/color: var\(--placeholder\)/);
    expect(body).toMatch(/opacity: 1(?![.\d])/);
    expect(body).not.toMatch(/--muted/);
  });

  it("never lowers the opacity of a field or its placeholder below 1", () => {
    const block = CSS.slice(CSS.indexOf("input::placeholder"), CSS.indexOf(".warning {"));
    expect([...block.matchAll(/opacity:\s*([\d.]+)/g)].map((m) => m[1])).not.toContainEqual(
      expect.stringMatching(/^0/),
    );
  });
});

describe("the disabled look (decision D74)", () => {
  const DISABLED = LINES_DISABLED;

  it("greys the text with --placeholder, draws a dotted line and shows not-allowed", () => {
    const body = rule(DISABLED);
    expect(body).toMatch(/color: var\(--placeholder\)/);
    expect(body).toMatch(/border-bottom: 1px dotted var\(--control-line\)/);
    expect(body).toMatch(/cursor: not-allowed/);
    expect(body).toMatch(/background-color: transparent/);
  });

  it("covers text-like fields, textarea, select, date and time, and no radio or checkbox", () => {
    expect(DISABLED).toContain('input[type="date"]');
    expect(DISABLED).toContain('input[type="time"]');
    expect(DISABLED).toContain(".field select");
    expect(DISABLED).toContain("textarea");
    expect(CSS).not.toMatch(/radio[^{}]*:disabled|checkbox[^{}]*:disabled/);
    // The choice rule stays as it was.
    expect(rule(".choice:has(input:disabled)")).toMatch(/color: var\(--muted\)/);
  });

  it("keeps the focus accent off a read-only field and comes after the focus rule", () => {
    const body = rule(LINES_DISABLED_FOCUS);
    expect(body).toMatch(/border-bottom-width: 1px/);
    expect(body).toMatch(/border-bottom-color: var\(--control-line\)/);
    const accent = CSS.indexOf("border-bottom-color: var(--accent)");
    const disabled = CSS.indexOf("cursor: not-allowed");
    expect(accent).toBeGreaterThan(0);
    expect(disabled).toBeGreaterThan(accent);
  });

  it("keeps the placeholder of a disabled field in --placeholder", () => {
    const body = rule(
      `input${DISABLED_STATE}::placeholder, textarea${DISABLED_STATE}::placeholder`,
    );
    expect(body).toMatch(/color: var\(--placeholder\)/);
    expect(body).toMatch(/opacity: 1(?![.\d])/);
  });
});
