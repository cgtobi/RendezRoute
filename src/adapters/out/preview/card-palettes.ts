// The card's colours and shapes per instance palette (decision 004). Link previews are fetched by
// crawlers without cookies, so only the instance's palette (PALETTE) applies, never a visitor's own.
// The colour values are the light tokens of public/app.css and public/palettes/*.css (guarded by
// test/adapters/out/preview/card-palettes.test.ts); the shape follows each palette's character.
import { type HexColor, parseHexColor } from "../../../domain/color.ts";
import type { Palette } from "../../../domain/palette.ts";

/** A constant colour of this table; a malformed one is a programming error. */
function hex(value: string): HexColor {
  const parsed = parseHexColor(value);
  if (!parsed.ok) throw new Error(`Invalid card colour ${value}`);
  return parsed.value;
}

export interface CardPalette {
  /** The page colour; the title block's tint is mixed against it. */
  bg: HexColor;
  fg: string;
  muted: string;
  line: string;
  surface: string;
  accent: string;
  shape: {
    /** Corner radius of the title block, in pixels. */
    titleRadius: number;
    /** Corner radius of the time and area boxes, in pixels. */
    boxRadius: number;
    /** Border width of the time and area boxes, in pixels. */
    boxBorder: number;
    /** Border width of the title block, in pixels; 0 draws none. */
    titleBorder: number;
    /** The colour of the title block's border, if it has one. */
    titleBorderColor: string;
  };
}

export const CARD_PALETTES: Record<Palette, CardPalette> = {
  default: {
    bg: hex("#ffffff"),
    fg: "#16181d",
    muted: "#5c636e",
    line: "#e4e7eb",
    surface: "#f3f4f6",
    accent: "#2c67a8",
    shape: {
      titleRadius: 24,
      boxRadius: 12,
      boxBorder: 2,
      titleBorder: 0,
      titleBorderColor: "#16181d",
    },
  },
  mono: {
    bg: hex("#fefefe"),
    fg: "#111111",
    muted: "#595959",
    line: "#e5e5e5",
    surface: "#f5f5f5",
    accent: "#16181d",
    shape: {
      titleRadius: 24,
      boxRadius: 12,
      boxBorder: 2,
      titleBorder: 0,
      titleBorderColor: "#111111",
    },
  },
  bold: {
    bg: hex("#fefefe"),
    fg: "#0a0a0a",
    muted: "#4a4a4a",
    line: "#0a0a0a",
    surface: "#f4f4f2",
    accent: "#d8261c",
    shape: {
      titleRadius: 0,
      boxRadius: 0,
      boxBorder: 2,
      titleBorder: 2,
      titleBorderColor: "#0a0a0a",
    },
  },
};
