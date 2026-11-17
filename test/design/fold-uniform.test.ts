// All folds look alike (decision D81): no accent bar, no bold title, and a focused summary shows
// a 2 px accent line instead of the 3 px frame. The pixels are checked by e2e/field-style.spec.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const CSS = readFileSync(join(import.meta.dirname, "../../public/app.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\s+/g, " ");

describe("folds", () => {
  it("have no strong variant: no bar, no bold title", () => {
    expect(CSS).not.toContain("fold-strong");
    expect(CSS).not.toMatch(/\.fold[^{]*::before/);
  });

  it("keep the warning colour of the summary text, a state and not decoration", () => {
    expect(CSS).toMatch(/\.fold-warning \.fold-value \{[^}]*color: var\(--danger\)/);
  });

  it("show a 2 px accent line under a focused summary, with no outline, outside forced colours", () => {
    const match =
      /@media \(forced-colors: none\) \{ details > summary:focus-visible \{([^}]*)\} \}/.exec(CSS);
    expect(match?.[1]).toMatch(/outline: none/);
    expect(match?.[1]).toMatch(/box-shadow: inset 0 -2px 0 var\(--accent\)/);
  });

  it("keep a system outline inside the row in forced colours", () => {
    const match =
      /@media \(forced-colors: active\) \{ details > summary:focus-visible \{([^}]*)\} \}/.exec(
        CSS,
      );
    expect(match?.[1]).toMatch(/outline: 2px solid Highlight/);
    expect(match?.[1]).toMatch(/outline-offset: -2px/);
  });
});
