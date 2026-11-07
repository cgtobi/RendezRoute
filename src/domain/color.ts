// Plan colors (spec 3.1): strict #RRGGBB, and text on the primary color chosen for contrast.
import { err, ok, type Result } from "./result.ts";

declare const validated: unique symbol;
/**
 * A strict, upper-case #RRGGBB color. Only parseHexColor (and the constants below)
 * produce it, so unvalidated strings cannot reach the per-plan stylesheet.
 */
export type HexColor = string & { readonly [validated]: true };

/** For literal constants in this module only. */
const constant = (value: string) => value as HexColor;

export const DEFAULT_COLORS = {
  primary: constant("#2E5BFF"),
  secondary: constant("#FF7A45"),
} as const;

const WHITE = constant("#FFFFFF");
const NEAR_BLACK = constant("#111111");

export function parseHexColor(value: string): Result<HexColor, "color_invalid"> {
  return /^#[0-9A-Fa-f]{6}$/.test(value)
    ? ok(value.toUpperCase() as HexColor)
    : err("color_invalid");
}

function relativeLuminance(hex: string): number {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG 2 contrast ratio between two colors (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

/** White or near-black, whichever has the higher contrast on `background` (ties go to white). */
export function textColorOn(background: HexColor): HexColor {
  return contrastRatio(background, WHITE) >= contrastRatio(background, NEAR_BLACK)
    ? WHITE
    : NEAR_BLACK;
}

export interface PlanTheme {
  primary: HexColor;
  onPrimary: HexColor;
  secondary: HexColor;
  onSecondary: HexColor;
}

/** The plan's colors with readable text on each (spec 3.1); secondary text uses only the pairing. */
export function planTheme(colors: { primary: HexColor; secondary: HexColor }): PlanTheme {
  return {
    primary: colors.primary,
    onPrimary: textColorOn(colors.primary),
    secondary: colors.secondary,
    onSecondary: textColorOn(colors.secondary),
  };
}
