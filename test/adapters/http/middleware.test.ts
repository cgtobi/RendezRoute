import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it } from "vite-plus/test";
import { csrf, type CsrfEnv } from "../../../src/adapters/in/http/csrf.ts";
import { requestLogger } from "../../../src/adapters/in/http/request-logger.ts";
import { securityHeaders } from "../../../src/adapters/in/http/security-headers.ts";
import { createLogger } from "../../../src/adapters/logging.ts";
import { type Config, loadConfig } from "../../../src/config.ts";

function config(env: Record<string, string> = {}): Config {
  const result = loadConfig({
    BASE_URL: "https://runs.example.org",
    CONTACT_EMAIL: "owner@example.org",
    ...env,
  });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.config;
}

describe("security headers (spec 3.8)", () => {
  function app(cfg: Config) {
    const hono = new Hono();
    hono.use(securityHeaders(cfg));
    hono.get("/ok", (c) => c.text("ok"));
    hono.get("/boom", () => {
      throw new Error("boom");
    });
    return hono;
  }

  it("sets the CSP, referrer policy and nosniff on normal, 404 and error responses", async () => {
    const hono = app(config());
    for (const path of ["/ok", "/missing", "/boom"]) {
      const response = await hono.request(path);
      expect(response.headers.get("content-security-policy")).toBe(
        "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; " +
          "img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self'; " +
          "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
      expect(response.headers.get("referrer-policy")).toBe("strict-origin");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  it("omits the tile host from img-src when maps are disabled", async () => {
    const response = await app(config({ MAPS_ENABLED: "false" })).request("/ok");
    expect(response.headers.get("content-security-policy")).toContain("img-src 'self' data:;");
  });

  it("keeps a stricter Referrer-Policy set by a route (secret-link responses)", async () => {
    const hono = new Hono();
    hono.use(securityHeaders(config()));
    hono.get("/a/x", (c) => {
      c.header("referrer-policy", "no-referrer");
      return c.text("confirm");
    });
    expect((await hono.request("/a/x")).headers.get("referrer-policy")).toBe("no-referrer");
  });
});

describe("CSRF protection (spec 3.8, decision I8)", () => {
  const key = randomBytes(32);

  function app(cfg: Config = config()) {
    const hono = new Hono<CsrfEnv>();
    hono.use(csrf({ key, config: cfg }));
    hono.get("/form", (c) => c.text(c.get("csrfToken")()));
    hono.get("/plain", (c) => c.text("no form here"));
    hono.post("/action", (c) => c.text("done"));
    return hono;
  }

  async function session(hono: ReturnType<typeof app>) {
    const response = await hono.request("/form");
    const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    return {
      cookie,
      token: await response.text(),
      setCookie: response.headers.get("set-cookie") ?? "",
    };
  }

  const post = (hono: ReturnType<typeof app>, headers: Record<string, string>, body?: string) =>
    hono.request("/action", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      body: body ?? "",
    });

  it("issues an HttpOnly, Secure, SameSite=Lax session cookie only when a form needs a token", async () => {
    const hono = app();
    expect((await hono.request("/plain")).headers.get("set-cookie")).toBeNull();
    const { setCookie } = await session(hono);
    expect(setCookie).toMatch(/^__Host-rr-csrf=[A-Za-z0-9_-]{43}; /);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).not.toMatch(/Max-Age|Expires/);
  });

  it("accepts a state change with a valid token in the form body or header", async () => {
    const hono = app();
    const { cookie, token } = await session(hono);
    expect((await post(hono, { cookie }, `_csrf=${token}`)).status).toBe(200);
    expect((await post(hono, { cookie, "x-csrf-token": token })).status).toBe(200);
  });

  it("rejects state changes without a valid token", async () => {
    const hono = app();
    const { cookie, token } = await session(hono);
    const other = await session(app());
    expect((await post(hono, { cookie })).status).toBe(403);
    expect((await post(hono, {}, `_csrf=${token}`)).status).toBe(403);
    expect((await post(hono, { cookie }, `_csrf=${token.slice(0, -2)}xx`)).status).toBe(403);
    expect((await post(hono, { cookie: other.cookie }, `_csrf=${token}`)).status).toBe(403);
  });

  it("rejects cross-origin requests even with a valid token", async () => {
    const hono = app();
    const { cookie, token } = await session(hono);
    expect(
      (await post(hono, { cookie, origin: "https://evil.example" }, `_csrf=${token}`)).status,
    ).toBe(403);
    expect(
      (await post(hono, { cookie, "sec-fetch-site": "cross-site" }, `_csrf=${token}`)).status,
    ).toBe(403);
    expect(
      (await post(hono, { cookie, origin: "https://runs.example.org" }, `_csrf=${token}`)).status,
    ).toBe(200);
  });

  it("uses a non-__Host cookie without Secure in development mode", async () => {
    const dev = config({ BASE_URL: "http://localhost:3000", ALLOW_INSECURE_DEV: "true" });
    const { setCookie } = await session(app(dev));
    expect(setCookie).toMatch(/^rr-csrf=/);
    expect(setCookie).not.toContain("Secure");
  });

  it("does not check safe methods", async () => {
    expect((await app().request("/plain", { method: "HEAD" })).status).toBe(200);
  });
});

describe("request logging (spec 3.8: never tokens, names, emails, coordinates or token URLs)", () => {
  it("logs the route pattern, method, status and duration, never the raw path, query or client details", async () => {
    const lines: string[] = [];
    const logger = createLogger({ write: (line) => lines.push(line) });
    const hono = new Hono();
    hono.use(requestLogger(logger));
    hono.get("/a/:token", (c) => c.text("ok"));

    const secret = "SENTINEL-token-0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9";
    await hono.request(`/a/${secret}?email=SENTINEL-mail@example.org&lat=48.1234`, {
      headers: { "user-agent": "SENTINEL-agent", "x-forwarded-for": "203.0.113.9" },
    });
    await hono.request("/nowhere/SENTINEL-path");

    const output = lines.join("\n");
    expect(output).not.toContain("SENTINEL");
    expect(output).not.toContain("48.1234");
    expect(output).not.toContain("203.0.113.9");
    const first = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(first).toMatchObject({
      level: "info",
      event: "request",
      method: "GET",
      route: "/a/:token",
      status: 200,
    });
    expect(typeof first.ms).toBe("number");
  });
});
