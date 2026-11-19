// Menu forms for language, units, theme and palette (decisions P5, D15, D64): POST + CSRF (checked by the app
// middleware), then back to the page they came from. Only same-site paths are followed, so the
// forms cannot serve as an open redirect.
import type { Context, Hono } from "hono";
import type { Config } from "../../../../config.ts";
import { isPalette } from "../../../../domain/palette.ts";
import { isTheme } from "../../../../domain/theme.ts";
import { isUnits } from "../../../../domain/units.ts";
import { isLanguage } from "../../../i18n/i18n.ts";
import type { AppEnv } from "../app.tsx";
import { clearPreference, type Preference, setPreference } from "../preference-cookies.ts";
import { isSecretLinkPath } from "./secret-links.tsx";
import { badRequest, formField, readForm } from "./shared.tsx";

export const RETURN_FIELD = "returnTo";

/** The palette menu's value for "whatever the instance uses"; never stored. */
export const SITE_PALETTE = "site";

/** A path on this site: one leading slash, then printable ASCII only (no "//" or "/\"). */
const LOCAL_PATH = /^\/(?![/\\])[\x21-\x7e]{0,2047}$/;

export function registerPreferenceRoutes(app: Hono<AppEnv>, { config }: { config: Config }): void {
  const choose =
    (
      preference: Preference,
      field: string,
      valid: (value: unknown) => boolean,
      /** A value that stands for the default, so its cookie is removed instead of set. */
      fallback?: string,
    ) =>
    async (c: Context<AppEnv>) => {
      const body = await readForm(c);
      if (body === undefined) return badRequest(c);
      const value = formField(body, field);
      if (!valid(value)) return badRequest(c);
      if (value === fallback) clearPreference(c, config, preference);
      else setPreference(c, config, preference, value);
      const returnTo = formField(body, RETURN_FIELD);
      const safe = LOCAL_PATH.test(returnTo) && !isSecretLinkPath(returnTo);
      return c.redirect(safe ? returnTo : "/", 303);
    };

  app.post("/language", choose("lang", "language", isLanguage));
  app.post("/units", choose("units", "units", isUnits));
  app.post("/theme", choose("theme", "theme", isTheme, "system"));
  // "site" is the instance's palette (decision 005): choosing it removes the cookie.
  app.post(
    "/palette",
    choose(
      "palette",
      "palette",
      (value) => value === SITE_PALETTE || isPalette(value),
      SITE_PALETTE,
    ),
  );
}
