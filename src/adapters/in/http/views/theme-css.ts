// Per-plan theme stylesheet (spec 3.1 Plan colors). Inline styles are forbidden by the CSP
// (spec 3.8), so colors arrive as custom properties. Only validated #RRGGBB values (the
// branded HexColor type) are interpolated into a fixed template. Tints mix with the page
// background, so they suit light and dark mode.
import { type PlanTheme, TINT_PERCENT } from "../../../../domain/color.ts";

export function themeCss(theme: PlanTheme): string {
  return `:root {
  --plan-primary: ${theme.primary};
  --plan-on-primary: ${theme.onPrimary};
  --plan-secondary: ${theme.secondary};
  --plan-on-secondary: ${theme.onSecondary};
  --plan-primary-tint: color-mix(in srgb, ${theme.primary} ${TINT_PERCENT.primary}%, var(--bg));
  --plan-secondary-tint: color-mix(in srgb, ${theme.secondary} ${TINT_PERCENT.secondary}%, var(--bg));
}
`;
}

/** Cache-busting version for the stylesheet URL: changes whenever the colors change. */
export const themeVersion = (colors: { primary: string; secondary: string }) =>
  `${colors.primary.slice(1)}-${colors.secondary.slice(1)}`;
