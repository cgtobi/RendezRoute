// Guards for "Remove route…" in the route fold of the host's edit form (decision D10): a quiet
// underlined line in the danger colour the zone gives it, with no colours, outlines or target
// sizes of its own. Its classes must not start with "route-" (e2e/css-state-coverage.spec.ts
// would silently skip them).
import { describe, expect, it } from "vite-plus/test";
import { loadStylesheet } from "../support/css.ts";

const css = loadStylesheet();
const own = css.all.filter((rule) => /remove-route/.test(rule.selector));

describe("Remove route…", () => {
  it("is an underlined summary without a marker, coloured by the danger zone", () => {
    const summary = css.rule(".remove-route > summary");
    expect(summary).toContain("text-decoration: underline");
    expect(summary).toContain("list-style: none");
    expect(css.rule(".remove-route > summary::-webkit-details-marker")).toContain("display: none");
    expect(
      css.all.some(
        (rule) =>
          rule.selector.split(",").some((part) => part.trim() === ".danger-zone summary") &&
          rule.body.includes("color: var(--danger)"),
      ),
    ).toBe(true);
  });

  it("sits closer to the fields than a zone of its own", () => {
    expect(css.rule(".remove-route")).toContain("margin: var(--s3) 0");
  });

  it("adds no colours, outlines, target sizes or state rules", () => {
    expect(own.length).toBeGreaterThan(0);
    const body = own.map((rule) => rule.body).join("\n");
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|color|background|border/);
    expect(body).not.toMatch(/outline|min-height|height:/);
    expect(
      own.filter((rule) => /:(hover|focus|active|checked)|\[open\]/.test(rule.selector)),
    ).toEqual([]);
    expect(
      css.all.filter((rule) => /\.route-/.test(rule.selector) && /remove/.test(rule.selector)),
    ).toEqual([]);
  });
});
