// Viewer preferences (decisions P5, D15): language and units, each in its own cookie holding only
// that value. Set by the footer forms; HttpOnly, Secure, SameSite=Lax, Max-Age 400 days.
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Config } from "../../../config.ts";
import { LONG_COOKIE_SECONDS } from "./cookie-lifetime.ts";

export type Preference = "lang" | "units";

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

export function setPreference(
  c: Context,
  config: Config,
  preference: Preference,
  value: string,
): void {
  setCookie(c, cookieName(config, preference), value, {
    httpOnly: true,
    secure: !config.allowInsecureDev,
    sameSite: "Lax",
    path: "/",
    maxAge: LONG_COOKIE_SECONDS,
  });
}
