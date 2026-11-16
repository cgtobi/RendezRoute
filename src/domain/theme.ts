// How a viewer wants the pages to look (decision D64): follow the system, or always light or dark.
// "system" is the default and is never stored.
export type Theme = "system" | "light" | "dark";

export const THEMES: readonly Theme[] = ["system", "light", "dark"];

export function isTheme(value: unknown): value is Theme {
  return value === "system" || value === "light" || value === "dark";
}
