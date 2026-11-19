// Per-plan theme stylesheet (spec 3.1 Plan colors). Inline styles are forbidden by the CSP
// (spec 3.8), so colors arrive as custom properties. Only validated #RRGGBB values (the
// branded HexColor type) are interpolated into a fixed template. Tints mix with the page
// background, so they suit light and dark mode. --plan-ink-on-light and --plan-ink-on-dark are the
// primary colour made readable (at least 5:1, hue kept) on the bold palette's light and dark page
// backgrounds, for links, the logo and the site name there; the raw primary is not safe as text.
import { type PlanTheme, planInk, TINT_PERCENT } from "../../../../domain/color.ts";

export function themeCss(theme: PlanTheme): string {
  const ink = planInk(theme.primary);
  return `:root {
  --plan-primary: ${theme.primary};
  --plan-on-primary: ${theme.onPrimary};
  --plan-secondary: ${theme.secondary};
  --plan-on-secondary: ${theme.onSecondary};
  --plan-ink-on-light: ${ink.onLight};
  --plan-ink-on-dark: ${ink.onDark};
  --plan-primary-tint: color-mix(in srgb, ${theme.primary} ${TINT_PERCENT.primary}%, var(--bg));
  --plan-secondary-tint: color-mix(in srgb, ${theme.secondary} ${TINT_PERCENT.secondary}%, var(--bg));
}
`;
}

/** Cache-busting version for the stylesheet URL: changes whenever the colors change or THEME_FORMAT (the set of properties) does. */
export const THEME_FORMAT = 2;
export const themeVersion = (colors: { primary: string; secondary: string }) =>
  `${colors.primary.slice(1)}-${colors.secondary.slice(1)}-${THEME_FORMAT}`;
