// All folds look alike (decision D81): no accent bar, no bold title, and a focused summary shows
// a 2 px accent line instead of the 3 px frame. The pixels are checked by e2e/field-style.spec.ts.
import { describe, expect, it } from "vite-plus/test";
import { loadStylesheet } from "../support/css.ts";

const css = loadStylesheet();
const SUMMARY_FOCUS = "details > summary:focus-visible";

describe("folds", () => {
  it("have no strong variant: no bar, no bold title", () => {
    expect(css.text).not.toContain("fold-strong");
    expect(css.text).not.toMatch(/\.fold[^{]*::before/);
  });

  it("keep the warning colour of the summary text, a state and not decoration", () => {
    expect(css.rule(".fold-warning .fold-value")).toMatch(/color: var\(--danger\)/);
  });

  it("show a 2 px accent line under a focused summary, with no outline, outside forced colours", () => {
    const body = css.rule(SUMMARY_FOCUS, { atRule: "forced-colors: none" });
    expect(body).toMatch(/outline: none/);
    expect(body).toMatch(/box-shadow: inset 0 -2px 0 var\(--accent\)/);
  });

  it("keep a system outline inside the row in forced colours", () => {
    const body = css.rule(SUMMARY_FOCUS, { atRule: "forced-colors: active" });
    expect(body).toMatch(/outline: 2px solid Highlight/);
    expect(body).toMatch(/outline-offset: -2px/);
  });
});
