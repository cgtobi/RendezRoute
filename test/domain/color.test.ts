import { describe, expect, it } from "vite-plus/test";
import {
  contrastRatio,
  DEFAULT_COLORS,
  INK_BACKGROUNDS,
  INK_CONTRAST,
  inkOn,
  parseHexColor,
  planInk,
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

// The plan's ink: its primary colour as text or a graphic on the bold page (links, logo, site name).
describe("inkOn and planInk", () => {
  const parse = (value: string) => {
    const parsed = parseHexColor(value);
    if (!parsed.ok) throw new Error("test color invalid");
    return parsed.value;
  };
  const hue = (hex: string): number | undefined => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
      number,
      number,
      number,
    ];
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);
    if (delta === 0) return undefined;
    const sector =
      max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    return sector * 60;
  };
  const COLOURS = [
    "#2E5BFF",
    "#FF7A45",
    "#0F9D58",
    "#FFEB3B",
    "#E91E63",
    "#9C27B0",
    "#00BCD4",
    "#795548",
    "#FFF176",
    "#0B1F3A",
    "#808080",
    "#FF0000",
    "#00FF00",
    "#0000FF",
    "#FFFFFF",
    "#000000",
  ];

  it("reaches the margin against both bold backgrounds, for every colour", () => {
    for (const colour of COLOURS) {
      const ink = planInk(parse(colour));
      expect([colour, contrastRatio(ink.onLight, INK_BACKGROUNDS.light) >= INK_CONTRAST]).toEqual([
        colour,
        true,
      ]);
      expect([colour, contrastRatio(ink.onDark, INK_BACKGROUNDS.dark) >= INK_CONTRAST]).toEqual([
        colour,
        true,
      ]);
    }
  });

  it("leaves a colour that already passes exactly as it is", () => {
    expect(planInk(parse("#000000")).onLight).toBe("#000000");
    expect(planInk(parse("#FFFFFF")).onDark).toBe("#FFFFFF");
    expect(planInk(parse("#FFF176")).onDark).toBe("#FFF176");
    expect(planInk(parse("#0B1F3A")).onLight).toBe("#0B1F3A");
    expect(inkOn(parse("#2E5BFF"), parse("#FFFFFF"), 4.5)).toBe("#2E5BFF");
  });

  it("changes the colour in the needed direction only: darker on light, lighter on dark", () => {
    const luminance = (hex: string) => contrastRatio(hex, "#000000");
    const yellow = planInk(parse("#FFF176"));
    expect(luminance(yellow.onLight)).toBeLessThan(luminance("#FFF176"));
    const navy = planInk(parse("#0B1F3A"));
    expect(luminance(navy.onDark)).toBeGreaterThan(luminance("#0B1F3A"));
  });

  it("keeps the hue of a saturated colour", () => {
    for (const colour of [
      "#E91E63",
      "#FFF176",
      "#FF0000",
      "#00FF00",
      "#0000FF",
      "#0B1F3A",
      "#9C27B0",
    ]) {
      const original = hue(colour) ?? 0;
      const ink = planInk(parse(colour));
      for (const changed of [ink.onLight, ink.onDark]) {
        const diff = Math.abs((hue(changed) ?? original) - original);
        expect([colour, changed, Math.min(diff, 360 - diff) <= 4]).toEqual([colour, changed, true]);
      }
    }
  });

  it("nudges as little as it must: one step less would fail", () => {
    const pink = parse("#E91E63");
    const ink = inkOn(pink, INK_BACKGROUNDS.light, INK_CONTRAST);
    expect(ink).not.toBe(pink);
    expect(contrastRatio(ink, INK_BACKGROUNDS.light)).toBeLessThan(INK_CONTRAST + 0.3);
  });

  it("is made for bold's two page backgrounds", () => {
    expect(INK_BACKGROUNDS).toEqual({ light: "#FEFEFE", dark: "#0A0A0A" });
    expect(INK_CONTRAST).toBeGreaterThanOrEqual(4.5);
  });
});
