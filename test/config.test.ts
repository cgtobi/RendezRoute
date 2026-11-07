import { describe, expect, it } from "vite-plus/test";
import { type Config, loadConfig } from "../src/config.ts";

const minimal = { BASE_URL: "https://runs.example.org", CONTACT_EMAIL: "owner@example.org" };

function ok(env: Record<string, string>): { config: Config; warnings: string[] } {
  const result = loadConfig(env);
  if (!result.ok) throw new Error(`expected valid config, got: ${result.errors.join("; ")}`);
  return result;
}

function errors(env: Record<string, string>): string[] {
  const result = loadConfig(env);
  if (result.ok) throw new Error("expected invalid config");
  return result.errors;
}

describe("defaults (spec section 10)", () => {
  it("produces a complete configuration from BASE_URL and CONTACT_EMAIL alone", () => {
    const { config, warnings } = ok(minimal);

    expect(config.baseUrl.href).toBe("https://runs.example.org/");
    expect(config.instanceName).toBe("RendezRoute");
    expect(config.dataDir).toBe("/data");
    expect(config.encryptionKeyFile).toBeUndefined();
    expect(config.trustProxy).toBe(false);
    expect(config.contactEmail).toBe("owner@example.org");
    expect(config.imprintUrl).toBeUndefined();
    expect(config.privacyUrl).toBeUndefined();
    expect(config.maxRetentionDays).toBe(30);
    expect(config.maxPlanHorizonDays).toBe(180);
    expect(config.defaultTimezone).toBe("UTC");
    expect(config.allowInsecureDev).toBe(false);
    expect(config.maps).toEqual({
      enabled: true,
      tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      tileCspSource: "https://tile.openstreetmap.org",
      attribution: "© OpenStreetMap contributors",
      serverSideTiles: true,
    });
    expect(config.geocoder).toEqual({
      enabled: true,
      url: new URL("https://nominatim.openstreetmap.org"),
    });
    expect(config.weather).toEqual({ enabled: true, url: new URL("https://api.open-meteo.com") });
    expect(warnings).toEqual([]);
  });

  it("reports every problem at once", () => {
    const found = errors({ BASE_URL: "nope", MAX_RETENTION_DAYS: "99", TRUST_PROXY: "yes" });
    expect(found).toHaveLength(3);
  });
});

describe("BASE_URL", () => {
  it("is required", () => {
    expect(errors({})).toEqual([expect.stringContaining("BASE_URL is required")]);
  });

  it("must be a valid URL", () => {
    expect(errors({ ...minimal, BASE_URL: "runs.example.org" })).toEqual([
      expect.stringContaining("BASE_URL"),
    ]);
  });

  it("must be a bare origin without path, query or fragment", () => {
    for (const url of [
      "https://example.org/runs",
      "https://example.org/?a=1",
      "https://example.org/#x",
    ]) {
      expect(errors({ ...minimal, BASE_URL: url })).toEqual([expect.stringContaining("BASE_URL")]);
    }
    expect(ok({ ...minimal, BASE_URL: "https://example.org/" }).config.baseUrl.href).toBe(
      "https://example.org/",
    );
  });

  it("must use HTTPS (spec section 11)", () => {
    expect(errors({ ...minimal, BASE_URL: "http://runs.example.org" })).toEqual([
      expect.stringContaining("HTTPS"),
    ]);
  });

  it("may use HTTP when ALLOW_INSECURE_DEV=true, with a development-mode warning", () => {
    const { config, warnings } = ok({
      ...minimal,
      BASE_URL: "http://localhost:3000",
      ALLOW_INSECURE_DEV: "true",
    });
    expect(config.allowInsecureDev).toBe(true);
    expect(config.baseUrl.href).toBe("http://localhost:3000/");
    expect(warnings).toEqual([expect.stringContaining("development mode")]);
  });
});

describe("booleans", () => {
  it.each([
    "TRUST_PROXY",
    "MAPS_ENABLED",
    "GEOCODER_ENABLED",
    "WEATHER_ENABLED",
    "ALLOW_INSECURE_DEV",
  ])("%s accepts only true or false", (name) => {
    expect(errors({ ...minimal, [name]: "yes" })).toEqual([expect.stringContaining(name)]);
    expect(() => ok({ ...minimal, [name]: "false" })).not.toThrow();
  });

  it("reads TRUST_PROXY", () => {
    expect(ok({ ...minimal, TRUST_PROXY: "true" }).config.trustProxy).toBe(true);
  });
});

describe("limits that may only be lowered", () => {
  it.each([
    ["MAX_RETENTION_DAYS", 30, "maxRetentionDays"],
    ["MAX_PLAN_HORIZON_DAYS", 180, "maxPlanHorizonDays"],
  ] as const)("%s accepts whole numbers from 1 to %i", (name, max, key) => {
    expect(ok({ ...minimal, [name]: "1" }).config[key]).toBe(1);
    expect(ok({ ...minimal, [name]: String(max) }).config[key]).toBe(max);
    for (const bad of ["0", String(max + 1), "7.5", "abc", ""]) {
      expect(errors({ ...minimal, [name]: bad })).toEqual([expect.stringContaining(name)]);
    }
  });
});

describe("DEFAULT_TIMEZONE", () => {
  it("accepts IANA zones", () => {
    expect(ok({ ...minimal, DEFAULT_TIMEZONE: "Europe/Berlin" }).config.defaultTimezone).toBe(
      "Europe/Berlin",
    );
  });

  it("rejects unknown zones", () => {
    expect(errors({ ...minimal, DEFAULT_TIMEZONE: "Mars/Olympus_Mons" })).toEqual([
      expect.stringContaining("DEFAULT_TIMEZONE"),
    ]);
  });
});

describe("INSTANCE_NAME", () => {
  it("is trimmed", () => {
    expect(ok({ ...minimal, INSTANCE_NAME: "  Isar Runners " }).config.instanceName).toBe(
      "Isar Runners",
    );
  });

  it("must be 1 to 60 characters", () => {
    expect(errors({ ...minimal, INSTANCE_NAME: "   " })).toEqual([
      expect.stringContaining("INSTANCE_NAME"),
    ]);
    expect(errors({ ...minimal, INSTANCE_NAME: "x".repeat(61) })).toEqual([
      expect.stringContaining("INSTANCE_NAME"),
    ]);
  });
});

describe("paths", () => {
  it("require absolute DATA_DIR and ENCRYPTION_KEY_FILE", () => {
    expect(errors({ ...minimal, DATA_DIR: "data" })).toEqual([expect.stringContaining("DATA_DIR")]);
    expect(errors({ ...minimal, ENCRYPTION_KEY_FILE: "keys/field.key" })).toEqual([
      expect.stringContaining("ENCRYPTION_KEY_FILE"),
    ]);
    const { config } = ok({
      ...minimal,
      DATA_DIR: "/srv/rr",
      ENCRYPTION_KEY_FILE: "/secrets/field.key",
    });
    expect(config.dataDir).toBe("/srv/rr");
    expect(config.encryptionKeyFile).toBe("/secrets/field.key");
  });
});

describe("CONTACT_EMAIL (spec section 10)", () => {
  it("must look like an email address", () => {
    expect(errors({ ...minimal, CONTACT_EMAIL: "owner" })).toEqual([
      expect.stringContaining("CONTACT_EMAIL"),
    ]);
  });

  it("when unset, disables geocoding and server-side tile fetching with a warning", () => {
    const { config, warnings } = ok({ BASE_URL: minimal.BASE_URL });
    expect(config.contactEmail).toBeUndefined();
    expect(config.geocoder.enabled).toBe(false);
    expect(config.maps.enabled).toBe(true);
    expect(config.maps.serverSideTiles).toBe(false);
    expect(warnings).toEqual([expect.stringContaining("CONTACT_EMAIL")]);
  });

  it("when unset, warns only about services that are enabled", () => {
    const { warnings } = ok({
      BASE_URL: minimal.BASE_URL,
      MAPS_ENABLED: "false",
      GEOCODER_ENABLED: "false",
    });
    expect(warnings).toEqual([]);
  });
});

describe("external services (spec 3.9)", () => {
  it("can each be disabled", () => {
    const { config } = ok({
      ...minimal,
      MAPS_ENABLED: "false",
      GEOCODER_ENABLED: "false",
      WEATHER_ENABLED: "false",
    });
    expect(config.maps.enabled).toBe(false);
    expect(config.maps.serverSideTiles).toBe(false);
    expect(config.geocoder.enabled).toBe(false);
    expect(config.weather.enabled).toBe(false);
  });

  it("can be redirected", () => {
    const { config } = ok({
      ...minimal,
      MAP_TILE_URL: "https://tiles.example.org/osm/{z}/{x}/{y}.png",
      MAP_ATTRIBUTION: "© Example",
      GEOCODER_URL: "https://geo.example.org/nominatim",
      WEATHER_URL: "https://weather.example.org",
    });
    expect(config.maps.tileUrl).toBe("https://tiles.example.org/osm/{z}/{x}/{y}.png");
    expect(config.maps.tileCspSource).toBe("https://tiles.example.org");
    expect(config.maps.attribution).toBe("© Example");
    expect(config.geocoder.url.href).toBe("https://geo.example.org/nominatim");
    expect(config.weather.url.href).toBe("https://weather.example.org/");
  });

  it("supports a {s} subdomain placeholder in MAP_TILE_URL with a wildcard CSP source", () => {
    const { config } = ok({
      ...minimal,
      MAP_TILE_URL: "https://{s}.tiles.example.org/{z}/{x}/{y}.png",
    });
    expect(config.maps.tileCspSource).toBe("https://*.tiles.example.org");
  });

  it("requires {z}, {x} and {y} in MAP_TILE_URL", () => {
    expect(errors({ ...minimal, MAP_TILE_URL: "https://tiles.example.org/{z}/{x}.png" })).toEqual([
      expect.stringContaining("MAP_TILE_URL"),
    ]);
  });

  it("requires a MAP_ATTRIBUTION when maps are enabled", () => {
    expect(errors({ ...minimal, MAP_ATTRIBUTION: " " })).toEqual([
      expect.stringContaining("MAP_ATTRIBUTION"),
    ]);
  });

  it.each(["MAP_TILE_URL", "GEOCODER_URL", "WEATHER_URL"])(
    "%s must use HTTPS outside development mode",
    (name) => {
      const value =
        name === "MAP_TILE_URL" ? "http://tiles.local/{z}/{x}/{y}.png" : "http://service.local";
      expect(errors({ ...minimal, [name]: value })).toEqual([expect.stringContaining(name)]);
      expect(() =>
        ok({
          ...minimal,
          BASE_URL: "http://localhost:3000",
          ALLOW_INSECURE_DEV: "true",
          [name]: value,
        }),
      ).not.toThrow();
    },
  );
});

describe("IMPRINT_URL and PRIVACY_URL", () => {
  it("accept http(s) URLs", () => {
    const { config } = ok({
      ...minimal,
      IMPRINT_URL: "https://club.example.org/imprint",
      PRIVACY_URL: "http://club.example.org/privacy",
    });
    expect(config.imprintUrl?.href).toBe("https://club.example.org/imprint");
    expect(config.privacyUrl?.href).toBe("http://club.example.org/privacy");
  });

  it("reject other schemes", () => {
    expect(errors({ ...minimal, IMPRINT_URL: "javascript:alert(1)" })).toEqual([
      expect.stringContaining("IMPRINT_URL"),
    ]);
  });
});
