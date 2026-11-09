// Device cookie (spec 3.2): one random token (only its hash is stored), HttpOnly,
// Secure, SameSite=Lax, Max-Age 400 days. Holds no other data.
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Config } from "../../../config.ts";
import { LONG_COOKIE_SECONDS } from "./cookie-lifetime.ts";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const cookieName = (config: Config) => (config.allowInsecureDev ? "rr-device" : "__Host-rr-device");

export function readDeviceToken(c: Context, config: Config): string | undefined {
  const value = getCookie(c, cookieName(config));
  return value !== undefined && TOKEN.test(value) ? value : undefined;
}

const cookieOptions = (config: Config, maxAge: number) =>
  ({
    httpOnly: true,
    secure: !config.allowInsecureDev,
    sameSite: "Lax",
    path: "/",
    maxAge,
  }) as const;

export function setDeviceToken(c: Context, config: Config, token: string): void {
  setCookie(c, cookieName(config), token, cookieOptions(config, LONG_COOKIE_SECONDS));
}

/** "Delete my data": the browser forgets the device, whose row is gone (spec 3.7). */
export function clearDeviceToken(c: Context, config: Config): void {
  setCookie(c, cookieName(config), "", cookieOptions(config, 0));
}
