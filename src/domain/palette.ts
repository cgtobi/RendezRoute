// The instance's colour palette (decision 004): the operator picks one for the whole instance.
// "default" is the colours of public/app.css and renders no attribute and no extra stylesheet.
export const PALETTES = ["default", "mono", "bold"] as const;

export type Palette = (typeof PALETTES)[number];

export function isPalette(value: unknown): value is Palette {
  return typeof value === "string" && (PALETTES as readonly string[]).includes(value);
}
