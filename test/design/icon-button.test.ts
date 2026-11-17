// Guards for the quiet icon button in the map status lines (decision D76, plan I93): a muted x at
// the end of the line, accent on hover and focus, 44 x 44 px, no box. The pixel result is checked by
// e2e/field-style.spec.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { loadStylesheet } from "../support/css.ts";

const PUBLIC = join(import.meta.dirname, "../../public");
const css = loadStylesheet();
const rule = (selector: string) => css.rule(selector);

// Two classes and two elements (0,2,2) on purpose: `.plan button:not(.secondary, .danger)` (0,2,1) must not win.
const BUTTON = ".point-readout p button.icon-button";
const forced = css.ruleText(css.forced());

describe("the quiet icon button in the status lines (decision D76)", () => {
  it("is a 44 x 44 px button without box, border or fill, muted at rest", () => {
    const body = rule(BUTTON);
    expect(body).toMatch(/width: var\(--target\)/);
    expect(body).toMatch(/min-width: var\(--target\)/);
    expect(body).toMatch(/height: var\(--target\)/);
    expect(body).toMatch(/min-height: var\(--target\)/);
    expect(body).toMatch(/border: 0(?![.\d])/);
    expect(body).toMatch(/background: transparent/);
    expect(body).toMatch(/color: var\(--muted\)/);
    expect(body).toMatch(/flex: none/);
  });

  it("outweighs the plan page's main-button rule", () => {
    // .plan button:not(.secondary, .danger) is (0,2,1); this one is (0,2,2).
    expect(BUTTON.split(".").length - 1).toBe(2);
    expect(BUTTON.split(/\s+/)).toContain("p");
    expect(BUTTON.split(/\s+/)).toContain("button.icon-button");
  });

  it("turns accent on hover and focus, without a fill, and keeps the global focus ring", () => {
    const body = rule(`${BUTTON}:hover, ${BUTTON}:focus-visible`);
    expect(body).toMatch(/color: var\(--accent\)/);
    expect(body).not.toMatch(/background: (?!transparent)/);
    expect(css.rule(":focus-visible")).toMatch(/outline/);
    expect(rule(`${BUTTON}:focus-visible`)).not.toMatch(/outline: (none|0)/);
  });

  it("gives the status text the remaining width and lets it wrap", () => {
    const body = rule(".point-readout .readout-text");
    expect(body).toMatch(/flex: 1/);
    expect(body).toMatch(/min-width: 0/);
  });

  it("draws the x with the .icon mask from public/icons/close.svg", () => {
    expect(rule(".icon-close")).toContain('--icon: url("icons/close.svg")');
    const svg = readFileSync(join(PUBLIC, "icons/close.svg"), "utf8");
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24"/);
    expect(svg).toContain('stroke="#000"');
    expect(svg.trimEnd()).toMatch(/<\/svg>$/);
    expect(svg).toMatch(/<path /);
    expect(Buffer.byteLength(svg)).toBeLessThan(600);
  });

  it("falls back to ButtonText in forced-colors mode", () => {
    expect(forced).toContain(`${BUTTON} {`);
    expect(forced).toMatch(/color: ButtonText/);
  });

  it("does not touch the search icon button", () => {
    expect(rule(".inline-input.line-action button.line-action-button")).toMatch(
      /color: var\(--accent\)/,
    );
  });
});
