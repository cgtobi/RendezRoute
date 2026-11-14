// The instance admin's session cookie (spec 7 Moderation): separate from the device cookie,
// HttpOnly, Secure, SameSite=Strict, as long as the session. On the admin listener (decision D55) it
// has another name and is Secure only over https. What the value means is up to
// `AdminAuth`; this file only carries it. It is never read as a device cookie, nor the other way.
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Config } from "../../../config.ts";
import { ADMIN_SESSION_COOKIE, secureForRequest } from "./admin-listener.ts";

const cookieName = (config: Config) =>
  config.admin !== undefined
    ? ADMIN_SESSION_COOKIE
    : config.allowInsecureDev
      ? "rr-admin"
      : "__Host-rr-admin";

const options = (c: Context, config: Config, maxAge: number) =>
  ({
    httpOnly: true,
    secure: config.admin !== undefined ? secureForRequest(config)(c) : !config.allowInsecureDev,
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
  setCookie(c, cookieName(config), session.value, options(c, config, maxAge));
}

export function adminSessionOf(c: Context, config: Config): string | undefined {
  return getCookie(c, cookieName(config));
}

export function endAdminSession(c: Context, config: Config) {
  setCookie(c, cookieName(config), "", options(c, config, 0));
}
