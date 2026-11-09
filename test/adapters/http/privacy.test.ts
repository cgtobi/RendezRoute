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
    ] as const) {
      expect(text(html)).toContain(en(key));
    }
    expect(text(html)).toContain(en("privacy.cookieDevice", { days: 400 }));
    expect(text(html)).toContain(en("privacy.cookiePreferences", { days: 400 }));
    expect(text(html)).toContain(en("privacy.devices", { unlinkedDays: 30, unusedDays: 365 }));
  });

  it("says that place searches are cached, and that “Use my location” moves the map", async () => {
    const { html } = await page();
    expect(text(html)).toContain(
      en("privacy.geocoder", { host: "nominatim.openstreetmap.org", days: 7 }),
    );
    expect(text(html)).toContain(en("privacy.locationMap"));
    expect(text((await page({ MAPS_ENABLED: "false" })).html)).not.toContain(
      en("privacy.locationMap"),
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
