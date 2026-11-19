import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { createApp as createAppWithDeps } from "../../../src/adapters/in/http/app.tsx";
import { createRateLimits } from "../../../src/adapters/in/http/rate-limit.ts";
import { en } from "../../../src/adapters/i18n/messages/en.ts";
import { createLogger } from "../../../src/adapters/logging.ts";
import { FakeClock } from "../../fakes/clock.ts";
import { SequentialIdGenerator } from "../../fakes/ids.ts";
import { createFakeRepositories } from "../../fakes/repositories.ts";
import { FakePreviewRenderer } from "../../fakes/preview-renderer.ts";
import { FakeRouteParser } from "../../fakes/route-parser.ts";
import { FakeTokenService } from "../../fakes/tokens.ts";
import { type Config, loadConfig } from "../../../src/config.ts";

const createApp = ({ config }: { config: Config }) =>
  createAppWithDeps({
    config,
    csrfKey: randomBytes(32),
    logger: createLogger({ write: () => {} }),
    geocoder: undefined,
    previewRenderer: new FakePreviewRenderer(),
    weather: undefined,
    rateLimits: createRateLimits(() => 0),
    vapidPublicKey: "B" + "A".repeat(86),
    planDeps: {
      ...createFakeRepositories(),
      routeParser: new FakeRouteParser(),
      tokens: new FakeTokenService(),
      ids: new SequentialIdGenerator(),
      clock: new FakeClock(),
      limits: { horizonDays: 180, maxRetentionDays: 30 },
      postingMode: "anyone",
    },
  });

function config(env: Record<string, string> = {}): Config {
  const result = loadConfig({
    BASE_URL: "https://runs.example.org",
    CONTACT_EMAIL: "owner@example.org",
    ...env,
  });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.config;
}

describe("GET /healthz", () => {
  it("answers 200 for the Docker HEALTHCHECK", async () => {
    const response = await createApp({ config: config() }).request("/healthz");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });
});

describe("page layout", () => {
  it("shows the instance name in title and header (spec section 2)", async () => {
    const response = await createApp({ config: config({ INSTANCE_NAME: "Isar Runners" }) }).request(
      "/",
    );
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("<title>Isar Runners</title>");
    expect(html).toMatch(/<header[^>]*>[\s\S]*Isar Runners[\s\S]*<\/header>/);
  });

  it("shows 'Powered by RendezRoute' only when the instance name differs from the default", async () => {
    const custom = await (
      await createApp({ config: config({ INSTANCE_NAME: "Isar Runners" }) }).request("/")
    ).text();
    const standard = await (await createApp({ config: config() }).request("/")).text();
    expect(custom).toContain("Powered by RendezRoute");
    expect(standard).not.toContain("Powered by");
  });

  it("escapes the instance name", async () => {
    const html = await (
      await createApp({ config: config({ INSTANCE_NAME: "<b>Club</b>" }) }).request("/")
    ).text();
    expect(html).not.toContain("<b>Club</b>");
    expect(html).toContain("&lt;b&gt;Club&lt;/b&gt;");
  });

  it("shows a development-mode banner on every page when ALLOW_INSECURE_DEV=true (spec section 11)", async () => {
    const dev = config({ BASE_URL: "http://localhost:3000", ALLOW_INSECURE_DEV: "true" });
    const html = await (await createApp({ config: dev }).request("/")).text();
    expect(html).toContain("Development mode");
    expect(await (await createApp({ config: config() }).request("/")).text()).not.toContain(
      "Development mode",
    );
  });

  it("puts a burger button in the header that opens the sheet with the links and preferences (decisions D68, I85)", async () => {
    const html = await (
      await createApp({ config: config({ NEARBY_ENABLED: "true" }) }).request("/")
    ).text();
    const header =
      /<header class="site-header site-header-menu">([\s\S]*?)<\/header>/.exec(html)?.[1] ?? "";
    expect(header).toMatch(
      /<button type="button" class="burger" popovertarget="site-menu" aria-label="Menu">/,
    );
    const sheet = /<div id="site-menu" popover="auto">([\s\S]*)<\/div>$/.exec(header)?.[1] ?? "";
    expect(header.indexOf("</button>")).toBeLessThan(header.indexOf('id="site-menu"'));
    expect(sheet).not.toContain("Close");
    for (const part of [
      'action="/language"',
      'action="/units"',
      'action="/theme"',
      'action="/palette"',
      'href="/my-data"',
      'href="/nearby"',
    ]) {
      expect(sheet).toContain(part);
    }
    // Each form keeps its Change button and the instant-apply marker.
    expect(sheet.match(/<button type="submit" class="secondary">Change<\/button>/g)).toHaveLength(
      4,
    );
    expect(sheet.match(/<select [^>]*data-auto-submit/g)).toHaveLength(4);
    // The links come before the four preference rows.
    const lastLink = sheet.lastIndexOf("<a ");
    expect(lastLink).toBeGreaterThan(-1);
    expect(lastLink).toBeLessThan(sheet.indexOf('action="/language"'));
    expect(sheet.indexOf('action="/language"')).toBeLessThan(sheet.indexOf('action="/units"'));
    expect(sheet.indexOf('action="/units"')).toBeLessThan(sheet.indexOf('action="/theme"'));
    expect(sheet.indexOf('action="/theme"')).toBeLessThan(sheet.indexOf('action="/palette"'));
  });

  it("keeps only the legal links in the footer (decision D68)", async () => {
    const html = await (
      await createApp({
        config: config({ IMPRINT_URL: "https://club.example.org/imprint", NEARBY_ENABLED: "true" }),
      }).request("/")
    ).text();
    const footer = /<footer class="site-footer">([\s\S]*?)<\/footer>/.exec(html)?.[1] ?? "";
    expect(footer).toContain('href="/privacy"');
    expect(footer).toContain('href="https://club.example.org/imprint"');
    for (const gone of ["footer-menu", "<form", "<select", "/my-data", "/nearby", "/account"]) {
      expect(footer).not.toContain(gone);
    }
    expect(html).not.toContain("footer-menu");
  });

  it("loads the bundled font stylesheet before the app's own (decision D27)", async () => {
    const html = await (await createApp({ config: config() }).request("/")).text();
    const fonts = html.indexOf('<link rel="stylesheet" href="/static/build/fonts.css');
    expect(fonts).toBeGreaterThan(-1);
    expect(fonts).toBeLessThan(html.indexOf('<link rel="stylesheet" href="/static/app.css?v='));
  });

  it("sets the page language from Accept-Language", async () => {
    const response = await createApp({ config: config() }).request("/", {
      headers: { "accept-language": "fr,en;q=0.5" },
    });
    expect(await response.text()).toContain('<html lang="fr">');
  });
});

describe("app-wide middleware", () => {
  it("applies the security headers to pages and health checks", async () => {
    const app = createApp({ config: config() });
    for (const path of ["/", "/healthz", "/missing"]) {
      const response = await app.request(path);
      expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  it("rejects state-changing requests without a CSRF token, with a translated message", async () => {
    const response = await createApp({ config: config() }).request("/", { method: "POST" });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain(en["error.csrf"]);
  });

  it("answers unexpected errors with a translated message and no details", async () => {
    const app = createApp({ config: config() });
    app.get("/boom", () => {
      throw new Error("SENTINEL internal detail");
    });
    const response = await app.request("/boom");
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain(en["error.internal"]);
    expect(body).not.toContain("SENTINEL");
  });
});
