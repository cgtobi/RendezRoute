// Footer forms for language and units (decisions P5, D15): POST + CSRF (checked by the app
// middleware), then back to the page they came from. Only same-site paths are followed, so the
// forms cannot serve as an open redirect.
import type { Context, Hono } from "hono";
import type { Config } from "../../../../config.ts";
import { isUnits } from "../../../../domain/units.ts";
import { isLanguage } from "../../../i18n/i18n.ts";
import type { AppEnv } from "../app.tsx";
import { type Preference, setPreference } from "../preference-cookies.ts";

export const RETURN_FIELD = "returnTo";

/** A path on this site: one leading slash, then printable ASCII only (no "//" or "/\"). */
const LOCAL_PATH = /^\/(?![/\\])[\x21-\x7e]{0,2047}$/;

export function registerPreferenceRoutes(app: Hono<AppEnv>, { config }: { config: Config }): void {
  const choose =
    (preference: Preference, field: string, valid: (value: unknown) => boolean) =>
    async (c: Context<AppEnv>) => {
      const body = await c.req.parseBody();
      const value = body[field];
      if (typeof value !== "string" || !valid(value)) {
        return c.text(c.get("t")("error.badRequest"), 400);
      }
      setPreference(c, config, preference, value);
      const returnTo = body[RETURN_FIELD];
      return c.redirect(
        typeof returnTo === "string" && LOCAL_PATH.test(returnTo) ? returnTo : "/",
        303,
      );
    };

  app.post("/language", choose("lang", "language", isLanguage));
  app.post("/units", choose("units", "units", isUnits));
}
