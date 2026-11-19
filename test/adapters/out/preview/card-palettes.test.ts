import { describe, expect, it } from "vite-plus/test";
import { type CardNode, cardElement } from "../../../../src/adapters/out/preview/card.ts";
import { CARD_PALETTES } from "../../../../src/adapters/out/preview/card-palettes.ts";
import { previewText } from "../../../../src/adapters/in/http/views/preview-text.ts";
import { previewOf } from "../../../../src/application/plan-views.ts";
import { PALETTES, type Palette } from "../../../../src/domain/palette.ts";
import { samplePlan } from "../../../fixtures/plans.ts";
import {
  colourTokens,
  customProperties,
  type CssRule,
  loadStylesheet,
} from "../../../support/css.ts";

const preview = previewOf(samplePlan());

const render = (palette: Palette) =>
  cardElement({
    text: previewText(preview),
    colors: preview.colors,
    instanceName: "Isar Runners",
    palette,
  });

const firstBlock = (list: readonly CssRule[]) => {
  const rule = list[0];
  if (rule === undefined) throw new Error("a token block is missing");
  return colourTokens(customProperties(rule));
};

const flatten = (root: CardNode): CardNode[] => {
  const nodes: CardNode[] = [];
  const walk = (child: unknown) => {
    if (Array.isArray(child)) return child.forEach(walk);
    if (typeof child !== "object" || child === null) return;
    nodes.push(child as CardNode);
    walk((child as CardNode).props.children);
  };
  walk(root);
  return nodes;
};

describe("card palettes (decision 004)", () => {
  it("equal the light tokens of the stylesheets", () => {
    const light: Record<Palette, Record<string, string>> = {
      default: firstBlock(loadStylesheet("app.css").tokenBlocks().light),
      mono: firstBlock(loadStylesheet("palettes/mono.css").tokenBlocks("mono").light),
      bold: firstBlock(loadStylesheet("palettes/bold.css").tokenBlocks("bold").light),
      archivo: firstBlock(loadStylesheet("palettes/archivo.css").tokenBlocks("archivo").light),
    };
    for (const palette of PALETTES) {
      const tokens = light[palette];
      const card = CARD_PALETTES[palette];
      for (const name of ["bg", "fg", "muted", "line", "surface", "accent"] as const) {
        expect(card[name].toLowerCase(), `${palette} ${name}`).toBe(tokens[`--${name}`]);
      }
    }
  });

  it("draws the default card as before", () => {
    const styles = flatten(render("default")).map((n) => n.props.style ?? {});
    expect(styles[0]).toMatchObject({ backgroundColor: "#FFFFFF", color: "#16181d" });
    expect(styles.some((s) => s.borderRadius === 24)).toBe(true);
    expect(styles.some((s) => s.borderRadius === 12 && s.backgroundColor === "#f3f4f6")).toBe(true);
  });

  it("draws mono with ink and grey tokens", () => {
    const tree = JSON.stringify(render("mono"));
    for (const colour of ["#fefefe", "#111111", "#595959", "#e5e5e5", "#f5f5f5"]) {
      expect(tree.toLowerCase()).toContain(colour.toLowerCase());
    }
    expect(tree).not.toContain("#2c67a8");
    expect(tree).not.toContain("#3c67a8");
  });

  it("draws archivo like mono, in Archivo Narrow", () => {
    const { font, shape, ...tokens } = CARD_PALETTES.archivo;
    const { font: monoFont, shape: monoShape, ...monoTokens } = CARD_PALETTES.mono;
    expect([font, monoFont]).toEqual(["Archivo Narrow", "Inter"]);
    expect(tokens).toEqual(monoTokens);
    expect(shape).toEqual({ ...monoShape, titleBorderColor: shape.titleBorderColor });
    const root = flatten(render("archivo")).map((n) => n.props.style ?? {})[0];
    expect(root).toMatchObject({ fontFamily: "Archivo Narrow" });
    expect(JSON.stringify(render("archivo"))).not.toContain('"Inter"');
  });

  it("draws bold with square corners, ink borders and the red accent", () => {
    const element = render("bold");
    const nodes = flatten(element);
    const styles = nodes.map((n) => n.props.style ?? {});
    expect(styles.filter((s) => s.borderRadius !== undefined)).not.toHaveLength(0);
    for (const s of styles) expect(s.borderRadius ?? 0).toBe(0);
    expect(styles.filter((s) => s.border === "2px solid #0a0a0a")).toHaveLength(3);
    const tree = JSON.stringify(element).toLowerCase();
    expect(tree).toContain("#d8261c");
    expect(tree).toContain("#f4f4f2");
    expect(tree).not.toContain("#2c67a8");
  });

  it("tints the title block against the palette's page colour", () => {
    const tint = (palette: Palette) =>
      flatten(render(palette)).find(
        (n) => n.props.style?.lineClamp === undefined && n.props.style?.padding === "28px 32px",
      )?.props.style?.backgroundColor;
    expect(tint("bold")).not.toBe(tint("default"));
  });
});
