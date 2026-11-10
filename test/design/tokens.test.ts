// The design tokens in public/app.css meet WCAG 2.2 AA in light and dark mode (decision D27):
// text 4.5:1 (1.4.3), field borders and focus rings 3:1 against the page (1.4.11).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { contrastRatio } from "../../src/domain/color.ts";

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
