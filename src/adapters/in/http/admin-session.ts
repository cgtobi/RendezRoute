// The instance admin's session cookie (spec 7 Moderation): separate from the device cookie,
// HttpOnly, Secure, SameSite=Strict, as long as the session. What the value means is up to
// `AdminAuth`; this file only carries it. It is never read as a device cookie, nor the other way.
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Config } from "../../../config.ts";

const cookieName = (config: Config) => (config.allowInsecureDev ? "rr-admin" : "__Host-rr-admin");

const options = (config: Config, maxAge: number) =>
  ({
    httpOnly: true,
    secure: !config.allowInsecureDev,
    sameSite: "Strict",
    path: "/",
    maxAge,
  }) as const;

export function setAdminSession(
  c: Context,
  config: Config,
  session: { value: string; expiresAt: Date },
  now: Date,
) {
  const maxAge = Math.round((session.expiresAt.getTime() - now.getTime()) / 1000);
  setCookie(c, cookieName(config), session.value, options(config, maxAge));
}

export function adminSessionOf(c: Context, config: Config): string | undefined {
  return getCookie(c, cookieName(config));
}

export function endAdminSession(c: Context, config: Config) {
  setCookie(c, cookieName(config), "", options(config, 0));
}
