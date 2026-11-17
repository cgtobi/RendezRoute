// The "Who can join and find it" fold shows its summary line only while closed (decision D79).
// The pixel result is checked by e2e/field-style.spec.ts.
import { describe, expect, it } from "vite-plus/test";
import { loadStylesheet, splitSelectorList } from "../support/css.ts";

const css = loadStylesheet();

describe("the summary line of a fold marked fold-hide-open", () => {
  it("is removed, with its hidden separator, only while that fold is open", () => {
    const body = css.rule(
      "details[open].fold-hide-open > summary .fold-value, details[open].fold-hide-open > summary .fold-sep",
    );
    expect(body).toMatch(/display: none/);
    // Nothing hides it while closed.
    const closedToo = css.all.filter((rule) =>
      splitSelectorList(rule.selector).at(-1)?.endsWith(".fold-hide-open > summary .fold-value"),
    );
    expect(closedToo.map((rule) => rule.selector)).toEqual([]);
  });
});
