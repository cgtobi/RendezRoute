// Guards for the icon button on a field's line (decision D75, plan I92): the map place search's
// magnifier sits at the end of the field's underline, one shared line under both. The pixel
// result is checked by e2e/field-style.spec.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { loadStylesheet } from "../support/css.ts";

const PUBLIC = join(import.meta.dirname, "../../public");
const css = loadStylesheet();
const CSS = css.text;
const rule = (selector: string) => css.rule(selector);

const ROW = ".inline-input.line-action";
const BUTTON = `${ROW} button.line-action-button`;
const INPUT = `${ROW} input:is(:not([type]), [type="search"], [type="text"])`;
const forced = css.ruleText(css.forced());

describe("the icon button on a line (decision D75)", () => {
  it("is a transparent 44 x 44 px button without border, radius or fill, in the accent colour", () => {
    const body = rule(BUTTON);
    expect(body).toMatch(/width: var\(--target\)/);
    expect(body).toMatch(/min-width: var\(--target\)/);
    expect(body).toMatch(/min-height: var\(--target\)/);
    expect(body).toMatch(/border: 0(?![.\d])/);
    expect(body).toMatch(/border-radius: 0(?![.\d])/);
    expect(body).toMatch(/background: transparent/);
    expect(body).toMatch(/color: var\(--accent\)/);
  });

  it("has no hover fill, keeps a focus state and the global focus ring", () => {
    expect(rule(`${BUTTON}:hover`)).toMatch(/background: transparent/);
    expect(rule(`${BUTTON}:hover`)).not.toMatch(/color-mix/);
    expect(css.rule(":focus-visible")).toMatch(/outline/);
    expect(rule(`${BUTTON}:focus-visible`)).toMatch(/outline-offset/);
  });

  it("lets the row draw one 1 px underline, thickened to 2 px accent on focus-within", () => {
    const row = rule(ROW);
    expect(row).toMatch(/border-bottom: 1px solid var\(--field-border\)/);
    expect(row).toMatch(/flex-wrap: nowrap/);
    const focus = rule(`${ROW}:focus-within`);
    expect(focus).toMatch(/border-bottom-width: 2px/);
    expect(focus).toMatch(/border-bottom-color: var\(--accent\)/);
  });

  it("takes the underline off the input inside the row, also on focus", () => {
    const body = rule(`${INPUT}, ${INPUT}:focus`);
    expect(body).toMatch(/border-bottom-width: 0(?![.\d])/);
  });

  it("shows the Required hint, a sibling of the row, while the control inside is empty (D77)", () => {
    expect(CSS).toContain(
      ":where(.inline-input.line-action:has(:required:placeholder-shown:not(:disabled, [readonly])))",
    );
  });

  it("is scoped to the row with the modifier, so other .inline-input rows are untouched", () => {
    expect(rule(".inline-input")).not.toMatch(/border/);
    expect(rule(".inline-input input")).not.toMatch(/border/);
  });

  it("draws the icon with the .icon mask from public/icons/search.svg in currentColor", () => {
    expect(rule(".icon-search")).toContain('--icon: url("icons/search.svg")');
    const svg = readFileSync(join(PUBLIC, "icons/search.svg"), "utf8");
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24"/);
    expect(svg.trimEnd()).toMatch(/<\/svg>$/);
    expect(svg).toMatch(/<circle /);
    expect(svg).toMatch(/<path /);
    expect(Buffer.byteLength(svg)).toBeLessThan(600);
  });

  it("falls back to system colours in forced-colors mode", () => {
    // The row's line colours (owner decision 2026-11-18): GrayText at rest, Highlight with the focus
    // or an error, from the forced-colors layer so they win over the accent and danger lines.
    const lines = css.all.filter((r) => r.layer === "forced-colors" && r.selector.includes(ROW));
    expect(lines.length).toBeGreaterThan(0);
    expect(forced).toMatch(/border-bottom-color: GrayText/);
    expect(forced).toContain(`${ROW}:focus-within`);
    expect(forced).toContain(`.field-invalid ${ROW}`);
    expect(forced).toContain(`${BUTTON} {`);
    expect(forced).toMatch(/color: ButtonText/);
  });
});
