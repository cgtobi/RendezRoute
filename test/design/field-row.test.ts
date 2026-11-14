// Layout guards for public/app.css. They only catch someone deleting or rewriting the lines below;
// that the layout really works is proven by the Playwright check e2e/layout-phone.spec.ts.
//
// 1. Two fields side by side (.field-row) must be able to shrink below the intrinsic width of the
//    native date and time inputs. iOS Safari gives them a large min-content width; with a plain
//    `1fr` track (minmax(auto, 1fr)) the columns stop shrinking and the second input overflows.
// 2. The footer menu's preference rows (.preference) keep select and button on one line.
import { readFileSync } from "node:fs";
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

describe(".preference (footer menu)", () => {
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

  it("separates the open menu body with a hairline, not a box", () => {
    const rule = declarationsFor(".footer-menu-body");
    expect(rule).toMatch(/border-top: 1px solid var\(--line\)/);
    expect(rule).not.toMatch(/background/);
  });
});
