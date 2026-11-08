// Language switcher (decision D15): POST + CSRF (checked by the app middleware), then back to the
// page it came from. Only same-site paths are followed, so it cannot serve as an open redirect.
import type { Hono } from "hono";
import type { Config } from "../../../../config.ts";
import { isLanguage } from "../../../i18n/i18n.ts";
import type { AppEnv } from "../app.tsx";
import { setLanguageCookie } from "../language-cookie.ts";

export const RETURN_FIELD = "returnTo";

/** A path on this site: one leading slash, then printable ASCII only (no "//" or "/\"). */
const LOCAL_PATH = /^\/(?![/\\])[\x21-\x7e]{0,2047}$/;

export function registerLanguageRoutes(app: Hono<AppEnv>, { config }: { config: Config }): void {
  app.post("/language", async (c) => {
    const body = await c.req.parseBody();
    if (!isLanguage(body.language)) return c.text(c.get("t")("error.badRequest"), 400);
    setLanguageCookie(c, config, body.language);
    const returnTo = body[RETURN_FIELD];
    return c.redirect(
      typeof returnTo === "string" && LOCAL_PATH.test(returnTo) ? returnTo : "/",
      303,
    );
  });
}
