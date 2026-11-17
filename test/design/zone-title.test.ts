// The time zone line's title (decision D80): muted like the line, the zone name in the text
// colour, and the title gone while the line is open. The pixels are checked by e2e/field-style.
import { describe, expect, it } from "vite-plus/test";
import { loadStylesheet, splitSelectorList } from "../support/css.ts";

const css = loadStylesheet();

describe("the time zone line title", () => {
  it("gives the zone name the text colour and leaves the title the line's muted one", () => {
    expect(css.rule(".zone-line [data-zone-name]")).toMatch(/^color: var\(--fg\);$/);
    // The muted colour is on a rule whose list starts with .zone-line.
    expect(
      css.all.some(
        (r) => r.selector.startsWith(".zone-line,") && /color: var\(--muted\)/.test(r.body),
      ),
    ).toBe(true);
    // Every rule that ends on .zone-title, whatever stands before it.
    const titleRules = css.all.filter((rule) =>
      splitSelectorList(rule.selector).at(-1)?.endsWith(".zone-title"),
    );
    expect(titleRules.length).toBeGreaterThan(0);
    expect(titleRules.map((rule) => rule.body).join(" ")).not.toMatch(/color/);
  });

  it("hides the title while the line is open, which also takes it out of the accessible name", () => {
    expect(css.rule("details[open] > summary .zone-title")).toMatch(/^display: none;$/);
  });
});
