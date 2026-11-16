// Viewer preferences (decisions P5, D15): language, units and theme, each in its own cookie holding only
// that value. Set by the footer forms; HttpOnly, Secure, SameSite=Lax, Max-Age 400 days.
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Config } from "../../../config.ts";
import { LONG_COOKIE_SECONDS } from "./cookie-lifetime.ts";

export type Preference = "lang" | "units" | "theme";

const cookieName = (config: Config, preference: Preference) =>
  config.allowInsecureDev ? `rr-${preference}` : `__Host-rr-${preference}`;

/** The raw cookie value; callers accept only known values. */
export function readPreference(
  c: Context,
  config: Config,
  preference: Preference,
): string | undefined {
  return getCookie(c, cookieName(config, preference));
}

/** One set of attributes for setting and deleting, so the two cannot drift apart. */
const cookieOptions = (config: Config) =>
  ({
    httpOnly: true,
    secure: !config.allowInsecureDev,
    sameSite: "Lax",
    path: "/",
  }) as const;

export function setPreference(
  c: Context,
  config: Config,
  preference: Preference,
  value: string,
): void {
  setCookie(c, cookieName(config, preference), value, {
    ...cookieOptions(config),
    maxAge: LONG_COOKIE_SECONDS,
  });
}

/** Back to the default: the browser drops the cookie. */
export function clearPreference(c: Context, config: Config, preference: Preference): void {
  deleteCookie(c, cookieName(config, preference), cookieOptions(config));
}
