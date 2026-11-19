// Plan colors (spec 3.1): strict #RRGGBB, and text on the primary color chosen for contrast.
import { err, ok, type Result } from "./result.ts";

declare const validated: unique symbol;
/**
 * A strict, upper-case #RRGGBB color. Only parseHexColor, tintOn (from two of them) and the
 * constants below produce it, so unvalidated strings cannot reach the per-plan stylesheet.
 */
export type HexColor = string & { readonly [validated]: true };

/** For literal constants in this module only. */
const constant = (value: string) => value as HexColor;

export const DEFAULT_COLORS = {
  primary: constant("#2E5BFF"),
  secondary: constant("#FF7A45"),
} as const;

export const WHITE = constant("#FFFFFF");
const NEAR_BLACK = constant("#111111");
const BLACK = constant("#000000");

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

/** How much of each plan color its tint holds (spec 3.1): behind the title, and the exact start. */
export const TINT_PERCENT = { primary: 12, secondary: 18 } as const;

/**
 * `color` mixed into `background` at `percent`, like CSS `color-mix(in srgb, …)`: for images, where
 * the stylesheet's tints cannot reach (the preview card, decision D30).
 */
export function tintOn(color: HexColor, percent: number, background: HexColor): HexColor {
  if (!(percent >= 0 && percent <= 100)) throw new RangeError(`tint of ${percent}%`);
  const channel = (hex: string, offset: number) => parseInt(hex.slice(offset, offset + 2), 16);
  const mixed = [1, 3, 5].map((offset) =>
    Math.round(
      (channel(color, offset) * percent + channel(background, offset) * (100 - percent)) / 100,
    )
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${mixed.join("")}`.toUpperCase() as HexColor;
}

/**
 * `color` made readable as text or a graphic on `background`: the colour itself when it already
 * has `minimum`:1 contrast, else the first mix toward black (on a light background) or white (on a
 * dark one) that does, in 1% steps. Mixing with black or white keeps the hue, so a plan's pink
 * stays pink, only deeper or paler. Black or white always passes (the last step), so it terminates.
 */
export function inkOn(color: HexColor, background: HexColor, minimum: number): HexColor {
  if (contrastRatio(color, background) >= minimum) return color;
  const target = relativeLuminance(background) > 0.5 ? BLACK : WHITE;
  for (let percent = 1; percent < 100; percent += 1) {
    const mixed = tintOn(target, percent, color);
    if (contrastRatio(mixed, background) >= minimum) return mixed;
  }
  return target;
}

/**
 * The page backgrounds the plan's ink is made for: the bold palette's --bg in light and in dark
 * (palettes/bold.css; a test keeps them equal). Menus and cards are a shade off these, so the
 * ink aims at INK_CONTRAST, a margin above WCAG's 4.5:1 for text.
 */
export const INK_BACKGROUNDS = { light: constant("#FEFEFE"), dark: constant("#0A0A0A") } as const;
export const INK_CONTRAST = 5;

/** The plan's primary colour as readable ink on a light and on a dark page (bold links, logo, title). */
export function planInk(primary: HexColor): { onLight: HexColor; onDark: HexColor } {
  return {
    onLight: inkOn(primary, INK_BACKGROUNDS.light, INK_CONTRAST),
    onDark: inkOn(primary, INK_BACKGROUNDS.dark, INK_CONTRAST),
  };
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
