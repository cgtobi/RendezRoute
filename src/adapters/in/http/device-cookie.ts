// Device cookie (spec 3.2): one random token (only its hash is stored), HttpOnly,
// Secure, SameSite=Lax, Max-Age 400 days. Holds no other data.
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Config } from "../../../config.ts";

const MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const cookieName = (config: Config) => (config.allowInsecureDev ? "rr-device" : "__Host-rr-device");

export function readDeviceToken(c: Context, config: Config): string | undefined {
  const value = getCookie(c, cookieName(config));
  return value !== undefined && TOKEN.test(value) ? value : undefined;
}

export function setDeviceToken(c: Context, config: Config, token: string): void {
  setCookie(c, cookieName(config), token, {
    httpOnly: true,
    secure: !config.allowInsecureDev,
    sameSite: "Lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}
