// The "Who can join and find it" fold shows its summary line only while closed (decision D79).
// The pixel result is checked by e2e/field-style.spec.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const CSS = readFileSync(join(import.meta.dirname, "../../public/app.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\s+/g, " ");

describe("the summary line of a fold marked fold-hide-open", () => {
  it("is removed, with its hidden separator, only while that fold is open", () => {
    const match =
      /details\[open\]\.fold-hide-open > summary \.fold-value, details\[open\]\.fold-hide-open > summary \.fold-sep \{([^}]*)\}/.exec(
        CSS,
      );
    expect(match?.[1]).toMatch(/display: none/);
    // Nothing hides it while closed.
    expect(CSS).not.toMatch(/\.fold-hide-open > summary \.fold-value \{/);
  });
});
