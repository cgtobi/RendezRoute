// Guards for the host page's save bar (decision 006): it sticks to the bottom only while the form
// is dirty or has problems, keeps the safe-area padding, uses tokens and a real border (forced
// colours), and does not touch outlines or target sizes. The pixel result is e2e/save-bar.spec.ts.
import { describe, expect, it } from "vite-plus/test";
import { PALETTES } from "../../src/domain/palette.ts";
import { loadStylesheet } from "../support/css.ts";

const css = loadStylesheet();
const own = css.all.filter((rule) => /save-bar/.test(rule.selector));

describe("the save bar", () => {
  it("is a plain row until the form is dirty, then sticks to the bottom with a top rule", () => {
    expect(css.rule(".save-bar")).not.toContain("position");
    const dirty = css.rule(".save-bar[data-dirty]");
    expect(dirty).toContain("position: sticky");
    expect(dirty).toContain("bottom: 0");
    expect(dirty).toContain("border-top-color: var(--line)");
    expect(dirty).toContain("background: var(--bg)");
  });

  it("pads the bottom by the safe area, in both states so nothing moves", () => {
    expect(css.rule(".save-bar")).toContain(
      "padding: var(--s3) 0 max(var(--s3), env(safe-area-inset-bottom))",
    );
    expect(css.rule(".save-bar")).toContain("border-top: 1px solid transparent");
  });

  it("keeps the focused field clear of the bar", () => {
    const padding = css.rule("html:has(.save-bar[data-dirty])");
    expect(padding).toContain("scroll-padding-bottom");
    expect(padding).toContain("env(safe-area-inset-bottom)");
    expect(padding).toContain("var(--target)");
  });

  it("colours with tokens only and draws the dot as a border", () => {
    const body = own.map((rule) => rule.body).join("\n");
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
    expect(css.rule(".save-bar-dot")).toContain("border: 0.3125rem solid var(--muted)");
    expect(css.rule(".save-bar[data-problem] .save-bar-status")).toContain("color: var(--danger)");
  });

  it("touches no outline and no target size", () => {
    const body = own.map((rule) => rule.body).join("\n");
    expect(body).not.toMatch(/outline|min-height|--target\)\s*;|height: [0-3]?\d(px|rem)\b/);
    expect(css.all.filter((rule) => /save-bar.*:focus/.test(rule.selector))).toEqual([]);
  });

  it("makes Discard a quiet button that keeps the 44 px base height", () => {
    const discard = css.rule("button.save-bar-discard");
    expect(discard).toContain("background: transparent");
    expect(discard).toContain("text-decoration: underline");
    expect(discard).toContain("margin-left: auto");
  });

  it("sits in the components layer, and only bold restyles it", () => {
    expect(
      css.all
        .filter((rule) => /save-bar/.test(rule.selector) && !/data-palette/.test(rule.selector))
        .map((r) => r.layer),
    ).toEqual(expect.arrayContaining(["components"]));
    const palette = css.all.filter(
      (rule) => /save-bar/.test(rule.selector) && /data-palette/.test(rule.selector),
    );
    // The dirty bar's heavy rule, the edge-to-edge band rule (a list of bands) and the link
    // colour rule, which leaves the bar's status link alone.
    expect(palette.map((rule) => rule.selector.slice(0, 40))).toEqual([
      ':root[data-palette="bold"] .save-bar[data-dirty]'.slice(0, 40),
      ':root[data-palette="bold"] :is(.plan-header,'.slice(0, 40),
      ':root[data-palette="bold"] a:not(.button, .plan'.slice(0, 40),
    ]);
    expect(palette[0]?.selector).toBe(':root[data-palette="bold"] .save-bar[data-dirty]');
    expect(palette[0]?.body).toBe("border-top-width: 2px;");
    expect(palette[1]?.body).toContain("margin-left: calc(-1 * var(--bd-bleed-l))");
    expect(palette[2]?.body).toBe("color: var(--plan-ink, var(--accent));");
    expect(palette.map((rule) => rule.layer)).toEqual(["pages", "pages", "pages"]);
  });

  it("leaves every palette sheet (mono, bold and archivo) without a save bar rule", () => {
    const mono = loadStylesheet("palettes/mono.css");
    const sheets = PALETTES.filter((name) => name !== "default");
    expect(sheets).toEqual(["mono", "bold", "archivo"]);
    for (const name of sheets) {
      const sheet = loadStylesheet(`palettes/${name}.css`);
      expect(sheet.all.filter((rule) => /save-bar/.test(rule.selector))).toEqual([]);
    }
    expect(mono.text).not.toContain("save-bar");
  });
});
