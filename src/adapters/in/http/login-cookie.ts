// The login cookie (spec 3.11 Account takeover): holds a started login's state, so only the browser
// that started a login can finish it. HttpOnly, Secure, SameSite=Lax (the provider sends the browser
// back with a top-level GET from its own site), ten minutes; cleared at the callback.
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Config } from "../../../config.ts";
import { LOGIN_WINDOW_MINUTES } from "../../../domain/identity.ts";

const STATE = /^[A-Za-z0-9_-]{16,128}$/;

const cookieName = (config: Config) => (config.allowInsecureDev ? "rr-login" : "__Host-rr-login");

const options = (config: Config, maxAge: number) =>
  ({
    httpOnly: true,
    secure: !config.allowInsecureDev,
    sameSite: "Lax",
    path: "/",
    maxAge,
  }) as const;

export function setLoginState(c: Context, config: Config, state: string): void {
  setCookie(c, cookieName(config), state, options(config, LOGIN_WINDOW_MINUTES * 60));
}

/** The state and the end of the cookie: it is used once. */
export function takeLoginState(c: Context, config: Config): string | undefined {
  const value = getCookie(c, cookieName(config));
  if (value !== undefined) setCookie(c, cookieName(config), "", options(config, 0));
  return value !== undefined && STATE.test(value) ? value : undefined;
}
