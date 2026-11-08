// Language cookie (decision D15): only a supported language tag, set by the footer switcher.
// HttpOnly, Secure, SameSite=Lax, Max-Age 400 days, like the device cookie.
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Config } from "../../../config.ts";
import type { Language } from "../../i18n/i18n.ts";

const MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

const cookieName = (config: Config) => (config.allowInsecureDev ? "rr-lang" : "__Host-rr-lang");

/** The raw cookie value; `resolveLanguage` ignores anything unsupported. */
export function readLanguageCookie(c: Context, config: Config): string | undefined {
  return getCookie(c, cookieName(config));
}

export function setLanguageCookie(c: Context, config: Config, language: Language): void {
  setCookie(c, cookieName(config), language, {
    httpOnly: true,
    secure: !config.allowInsecureDev,
    sameSite: "Lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}
