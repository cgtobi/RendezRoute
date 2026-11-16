import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { createTestApp } from "../../support/app.ts";
import { TestClient } from "../../support/client.ts";

async function page(env: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const test = await createTestApp({ env });
  const response = await test.app.request("/privacy", { headers });
  return { response, html: await response.text(), test };
}

const en = translator("en");
const text = (html: string) => html.replaceAll("&#39;", "'").replaceAll("&quot;", '"');

describe("privacy notice (spec 5 feature 13)", () => {
  it("is generated from the configuration", async () => {
    const { response, html } = await page();
    expect(response.status).toBe(200);
    expect(html).toContain(`<h1>${en("privacy.title")}</h1>`);
    expect(html).toContain('href="mailto:owner@example.org"');
    expect(html).toContain("tile.openstreetmap.org");
    expect(html).toContain("nominatim.openstreetmap.org");
    expect(text(html)).toContain(en("privacy.retention", { days: 30 }));
  });

  it("states what the owner can access, the cookies, logs and cached chat previews", async () => {
    const { html } = await page();
    for (const key of [
      "privacy.operator",
      "privacy.cookieCsrf",
      "privacy.logs",
      "privacy.rateLimits",
      "privacy.previews",
      "privacy.calendar",
      "privacy.storedRecap",
      "privacy.ratings",
      "privacy.templates",
      "privacy.myData",
    ] as const) {
      expect(text(html)).toContain(en(key));
    }
    expect(text(html)).toContain(en("privacy.cookieDevice", { days: 400 }));
    expect(text(html)).toContain(en("privacy.cookiePreferences", { days: 400 }));
    expect(text(html)).toContain(en("privacy.devices", { unlinkedDays: 30, unusedDays: 365 }));
  });

  it("says that place searches are cached, and that “Find my location” only moves the map", async () => {
    const { html } = await page();
    expect(text(html)).toContain(
      en("privacy.geocoder", { host: "nominatim.openstreetmap.org", days: 7 }),
    );
    expect(text(html)).toContain(en("privacy.location"));
    expect(text(html)).toContain(en("privacy.locationMap"));
    expect(en("privacy.location")).toContain("not sent to this server");
    const withoutMaps = text((await page({ MAPS_ENABLED: "false" })).html);
    expect(withoutMaps).not.toContain(en("privacy.location"));
    expect(withoutMaps).not.toContain(en("privacy.locationMap"));
  });

  it("says that picking a place on the map sends the rounded point, never the exact start (D70)", () => {
    for (const lang of ["en", "de", "fr"] as const) {
      const text = translator(lang)("privacy.geocoder", { host: "geo.example", days: 7 });
      expect(text).toContain("geo.example");
      expect(text).toContain("7");
      expect(text).toMatch(/1 km/);
    }
    expect(en("privacy.geocoder", { host: "h", days: 7 })).toMatch(
      /map and the meeting area is empty or still holds the earlier suggestion.*rounded.*about 1 km.*never the exact start/,
    );
  });

  it("states that pre-update backups are deleted after 7 days (spec 11)", async () => {
    expect(text((await page()).html)).toContain(en("privacy.backups", { days: 7 }));
  });

  it("follows the retention maximum, noting longer periods kept from before it was lowered", async () => {
    const lowered = text((await page({ MAX_RETENTION_DAYS: "7" })).html);
    expect(lowered).toContain(en("privacy.retention", { days: 7 }));
    expect(lowered).toContain(en("privacy.retentionLowered", { max: 30 }));
    expect(text((await page()).html)).not.toContain(en("privacy.retentionLowered", { max: 30 }));
  });

  it("leaves out services that are switched off", async () => {
    const noMaps = (await page({ MAPS_ENABLED: "false" })).html;
    expect(noMaps).not.toContain("tile.openstreetmap.org");
    expect(noMaps).toContain("nominatim.openstreetmap.org");

    const noGeocoder = (await page({ GEOCODER_ENABLED: "false" })).html;
    expect(noGeocoder).not.toContain("nominatim");

    const noContact = (await page({ CONTACT_EMAIL: "" })).html;
    expect(noContact).not.toContain("mailto:");
    expect(noContact).not.toContain("nominatim");
    expect(text(noContact)).not.toContain(en("privacy.tilesServer"));
    expect(noContact).toContain("tile.openstreetmap.org");
  });

  it("says that weather is fetched for the rough area only, when weather is on", async () => {
    expect(text((await page()).html)).toContain(
      en("privacy.weather", { host: "api.open-meteo.com", minutes: 60 }),
    );
    expect((await page({ WEATHER_ENABLED: "false" })).html).not.toMatch(/weather|open-meteo/i);
  });

  it("explains email addresses only when email is configured (decision D31)", async () => {
    expect(text((await page()).html)).not.toContain(en("privacy.email"));
    expect(text((await page()).html)).not.toContain(en("privacy.emailRateLimit"));
    const withSmtp = await page({ SMTP_HOST: "mail.example.org", SMTP_FROM: "runs@example.org" });
    expect(text(withSmtp.html)).toContain(en("privacy.email"));
    // Typed addresses are counted too (spec 3.11), as an in-memory hash.
    expect(text(withSmtp.html)).toContain(
      `${en("privacy.rateLimits")} ${en("privacy.emailRateLimit")}`,
    );
  });

  it("mentions the admin login cookie only when admin login is configured (spec 7)", async () => {
    expect(text((await page()).html)).not.toContain(en("privacy.cookieAdmin", { hours: 12 }));
    const withAdmin = await page({ ADMIN_TOKEN: "admin-token-for-tests-0123456789abcdef" });
    expect(text(withAdmin.html)).toContain(en("privacy.cookieAdmin", { hours: 12 }));
  });

  it("is translated", async () => {
    const { html } = await page({}, { "accept-language": "fr" });
    expect(html).toContain(`<h1>${translator("fr")("privacy.title")}</h1>`);
  });

  it("is replaced by PRIVACY_URL when set", async () => {
    const { response } = await page({ PRIVACY_URL: "https://club.example.org/privacy" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://club.example.org/privacy");
  });
});

describe("footer links (spec 5 feature 13)", () => {
  const footer = (html: string) => /<footer[\s\S]*<\/footer>/.exec(html)?.[0] ?? "";

  it("link the privacy notice on every page, and no imprint unless configured", async () => {
    const test = await createTestApp();
    const client = new TestClient(test.app);
    for (const path of ["/", "/new", "/privacy"]) {
      const html = footer(await (await client.get(path)).text());
      expect(html).toContain(`<a href="/privacy">${en("layout.privacy")}</a>`);
      expect(html).not.toContain(en("layout.imprint"));
    }
  });

  it("link IMPRINT_URL and PRIVACY_URL when set", async () => {
    const test = await createTestApp({
      env: {
        IMPRINT_URL: "https://club.example.org/imprint",
        PRIVACY_URL: "https://club.example.org/privacy",
      },
    });
    const html = footer(await (await new TestClient(test.app).get("/")).text());
    expect(html).toContain(
      `<a href="https://club.example.org/imprint" rel="noopener noreferrer">${en("layout.imprint")}</a>`,
    );
    expect(html).toContain(
      `<a href="https://club.example.org/privacy" rel="noopener noreferrer">${en("layout.privacy")}</a>`,
    );
  });

  it("show 'Powered by RendezRoute' only under another instance name", async () => {
    const plain = await createTestApp();
    expect(await (await plain.app.request("/")).text()).not.toContain("Powered by RendezRoute");
    const club = await createTestApp({ env: { INSTANCE_NAME: "Isar Runners" } });
    const html = await (await club.app.request("/")).text();
    expect(html).toContain("<title>Isar Runners</title>");
    expect(footer(html)).toContain("Powered by RendezRoute");
  });
});
