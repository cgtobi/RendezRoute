import { describe, expect, it } from "vite-plus/test";
import {
  contrastRatio,
  DEFAULT_COLORS,
  parseHexColor,
  planTheme,
  textColorOn,
  tintOn,
  WHITE,
} from "../../src/domain/color.ts";

const NEAR_BLACK = "#111111";

describe("parseHexColor (spec 3.1 Plan colors)", () => {
  it("accepts strict #RRGGBB and normalizes to upper case", () => {
    expect(parseHexColor("#2e5bff")).toEqual({ ok: true, value: "#2E5BFF" });
  });

  it("rejects anything else, so values can never inject CSS", () => {
    for (const value of [
      "2E5BFF",
      "#FFF",
      "#GGGGGG",
      "#2E5BFF ",
      "red",
      "#2E5BFF;}body{",
      "rgb(0,0,0)",
      "",
    ]) {
      expect(parseHexColor(value)).toEqual({ ok: false, error: "color_invalid" });
    }
  });

  it("has valid defaults", () => {
    expect(DEFAULT_COLORS).toEqual({ primary: "#2E5BFF", secondary: "#FF7A45" });
  });
});

describe("HexColor", () => {
  it("can only be produced by parsing, so unvalidated strings never reach CSS", () => {
    // @ts-expect-error: a plain string is not a HexColor
    const unchecked: HexColor = "#FFF;}body{";
    expect(unchecked).toBeDefined();
  });
});

describe("contrastRatio", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
  });
});

describe("textColorOn (spec 3.1, security test: contrast)", () => {
  it("chooses white on dark and near-black on light colors", () => {
    const on = (value: string) => {
      const parsed = parseHexColor(value);
      if (!parsed.ok) throw new Error("test color invalid");
      return textColorOn(parsed.value);
    };
    expect(on("#2E5BFF")).toBe(WHITE);
    expect(on("#000080")).toBe(WHITE);
    expect(on("#FFEB3B")).toBe(NEAR_BLACK);
    expect(on("#FFFFFF")).toBe(NEAR_BLACK);
  });

  // Picking the higher option means 4.5:1 is reached whenever either option can reach it.
  it("always picks the higher-contrast option", () => {
    const steps = [0x00, 0x22, 0x44, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xcc, 0xee, 0xff];
    const hex = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
    for (const r of steps) {
      for (const g of steps) {
        for (const b of steps) {
          const parsed = parseHexColor(`#${hex(r)}${hex(g)}${hex(b)}`);
          if (!parsed.ok) throw new Error("test color invalid");
          const background = parsed.value;
          const chosen = contrastRatio(background, textColorOn(background));
          const best = Math.max(
            contrastRatio(background, WHITE),
            contrastRatio(background, NEAR_BLACK),
          );
          expect(chosen).toBe(best);
        }
      }
    }
  });
});

describe("planTheme (spec 3.1 Plan colors)", () => {
  it("pairs each plan color with its readable text color", () => {
    const parse = (value: string) => {
      const parsed = parseHexColor(value);
      if (!parsed.ok) throw new Error("test color invalid");
      return parsed.value;
    };
    expect(planTheme({ primary: parse("#2E5BFF"), secondary: parse("#FFEB3B") })).toEqual({
      primary: "#2E5BFF",
      onPrimary: WHITE,
      secondary: "#FFEB3B",
      onSecondary: NEAR_BLACK,
    });
  });
});

describe("tintOn", () => {
  it("mixes a colour into a background like CSS color-mix in sRGB (decision D30)", () => {
    expect([
      tintOn(DEFAULT_COLORS.primary, 12, WHITE),
      tintOn(DEFAULT_COLORS.primary, 100, WHITE),
      tintOn(DEFAULT_COLORS.primary, 0, WHITE),
    ]).toEqual(["#E6EBFF", "#2E5BFF", "#FFFFFF"]);
  });

  it("refuses a share outside 0 to 100 percent, which would be no colour", () => {
    expect(() => tintOn(DEFAULT_COLORS.primary, 101, WHITE)).toThrow(RangeError);
    expect(() => tintOn(DEFAULT_COLORS.primary, -1, WHITE)).toThrow(RangeError);
  });
});
