// Layout guards for public/app.css. They only catch someone deleting or rewriting the lines below;
// that the layout really works is proven by the Playwright check e2e/layout-phone.spec.ts.
//
// 1. Two fields side by side (.field-row) must be able to shrink below the intrinsic width of the
//    native date and time inputs. iOS Safari gives them a large min-content width; with a plain
//    `1fr` track (minmax(auto, 1fr)) the columns stop shrinking and the second input overflows.
// 2. The footer menu's preference rows (.preference) keep select and button on one line.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

/** The stylesheet without comments, with one space for any whitespace and double quotes only. */
const CSS = readFileSync(join(import.meta.dirname, "../../public/app.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/'/g, '"')
  .replace(/\s+/g, " ");

/** A selector list as a sorted, normalised key: order and spacing around commas do not matter. */
function key(selectors: string): string {
  return selectors
    .split(",")
    .map((selector) => selector.trim().replace(/\s*([>+~])\s*/g, " $1 "))
    .sort()
    .join(", ");
}

/** The declarations of every top-level rule written for exactly this selector list, joined. */
function declarationsFor(selectors: string): string {
  const wanted = key(selectors);
  const found: string[] = [];
  // Top-level rules only: `selector { declarations }` outside any @media block.
  for (const match of CSS.matchAll(/(?<=^|[};])\s*([^{}@;][^{}]*)\{([^{}]*)\}/g)) {
    if (key(match[1] ?? "") === wanted) found.push(match[2] ?? "");
  }
  expect(found.length, `no rule for "${selectors}" in public/app.css`).toBeGreaterThan(0);
  return found.join(" ").replace(/\s*:\s*/g, ": ");
}

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
  });

  it("lets date and time inputs shrink and start-aligns their text", () => {
    // Same result whichever order the two selectors are written in.
    const rule = declarationsFor('input[type="time"], input[type="date"]');
    expect(rule).toMatch(/min-width: 0(?![.\d])/);
    expect(rule).toMatch(/max-width: 100%/);
    expect(rule).toMatch(/text-align: start/);
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
    expect(CSS).not.toMatch(/max-width: 339/);
  });

  it("makes the header sticky and the sheet fill the width under it", () => {
    expect(declarationsFor(".site-header-menu")).toMatch(/position: sticky/);
    expect(declarationsFor(".site-header-menu")).toMatch(/top: 0/);
    expect(CSS).toMatch(/@supports selector\(:popover-open\)/);
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
    expect(CSS).toMatch(/\.site-header-menu::before \{\s*content: "";/);
  });

  it("puts the menu in its own full-width row under the logo without popover support", () => {
    const block =
      /@supports not selector\(:popover-open\) \{(.*?)\} \} @supports/.exec(CSS)?.[1] ?? "";
    expect(block).toMatch(/\.site-header-menu \{ position: static;/);
    expect(block).toMatch(/#site-menu \{ grid-column: 1 \/ -1; grid-row: 2;/);
    expect(block).toMatch(/\.burger \{ display: none;/);
  });

  it("makes every map its own stacking context so Leaflet panes stay below the header", () => {
    expect(declarationsFor(".map")).toMatch(/isolation: isolate/);
  });
});

describe("the title field's pencil (decision D71)", () => {
  it("shows no dashed edit hint: the pencil is the hint, the input has no resting underline", () => {
    const rule = declarationsFor(".plan-form .title-input");
    expect(rule).not.toContain("dashed");
    expect(rule).toMatch(/border-bottom: 2px solid transparent/);
  });

  it("underlines solidly only on focus and, in the danger colour, on an error", () => {
    expect(declarationsFor(".plan-form .title-input:focus")).toMatch(
      /border-bottom-color: var\(--accent\)/,
    );
    expect(declarationsFor(".plan-form .field-invalid .title-input")).toMatch(
      /border-bottom-color: var\(--danger\)/,
    );
    expect(CSS).not.toMatch(/\.title-input:hover/);
  });

  it("draws the pencil over the field's end, not catching clicks, from the pencil mask", () => {
    const pencil = declarationsFor(".title-field .title-edit-icon");
    expect(pencil).toContain("pointer-events: none");
    expect(pencil).toContain("position: absolute");
    expect(declarationsFor(".title-field")).toContain("position: relative");
    expect(declarationsFor(".icon-pencil")).toContain('--icon: url("icons/pencil.svg")');
  });

  it("has a small valid pencil SVG like the other icons", () => {
    const file = join(import.meta.dirname, "../../public/icons/pencil.svg");
    expect(existsSync(file)).toBe(true);
    const svg = readFileSync(file, "utf8");
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24"/);
    expect(svg.trim().endsWith("</svg>")).toBe(true);
    expect(svg.length).toBeLessThan(600);
  });
});
