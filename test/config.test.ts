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
    expect(config.adminToken).toBeUndefined();
    expect(config.maps).toEqual({
      enabled: true,
      tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      tileCspSource: "https://tile.openstreetmap.org",
      tileHost: "tile.openstreetmap.org",
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

describe("ADMIN_TOKEN (spec 7 Moderation)", () => {
  it("is optional, and taken as given when long enough", () => {
    const token = "x".repeat(32);
    expect(ok({ ...minimal, ADMIN_TOKEN: token }).config.adminToken).toBe(token);
  });

  it("must be at least 32 characters, or the app refuses to start", () => {
    expect(errors({ ...minimal, ADMIN_TOKEN: "x".repeat(31) })).toEqual([
      "ADMIN_TOKEN must be at least 32 characters.",
    ]);
  });
});

describe("PUBLIC_REQUIRES_LOGIN (spec 7 Visibility and Nearby plans)", () => {
  it("requires an account for public plans unless turned off", () => {
    expect(ok(minimal).config.publicRequiresLogin).toBe(true);
    expect(ok({ ...minimal, PUBLIC_REQUIRES_LOGIN: "false" }).config.publicRequiresLogin).toBe(
      false,
    );
    expect(errors({ ...minimal, PUBLIC_REQUIRES_LOGIN: "no" })).toEqual([
      'PUBLIC_REQUIRES_LOGIN must be "true" or "false", got "no".',
    ]);
  });
});

describe("POSTING_MODE (spec 7 Moderation)", () => {
  it("lets anyone post by default", () => {
    expect(ok(minimal).config.postingMode).toBe("anyone");
    expect(ok({ ...minimal, POSTING_MODE: "anyone" }).config.postingMode).toBe("anyone");
  });

  it("accepts invite, which needs ADMIN_TOKEN, since only the admin creates invite links", () => {
    const token = "x".repeat(32);
    expect(ok({ ...minimal, POSTING_MODE: "invite", ADMIN_TOKEN: token }).config.postingMode).toBe(
      "invite",
    );
    expect(errors({ ...minimal, POSTING_MODE: "invite" })).toEqual([
      "POSTING_MODE=invite needs ADMIN_TOKEN: only the instance admin can create invite links.",
    ]);
  });

  it("accepts logged_in, which needs a way to log in", () => {
    expect(ok({ ...minimal, ...OIDC, POSTING_MODE: "logged_in" }).config.postingMode).toBe(
      "logged_in",
    );
    for (const env of [{}, { OIDC_ISSUER: "" }]) {
      expect(errors({ ...minimal, ...env, POSTING_MODE: "logged_in" })).toEqual([
        "POSTING_MODE=logged_in needs a way to log in: set OIDC_ISSUER and OIDC_CLIENT_ID, or FEDIVERSE_LOGIN=true.",
      ]);
    }
  });

  it("refuses other values", () => {
    for (const value of ["Invite", "nobody", "logged-in"]) {
      expect(errors({ ...minimal, POSTING_MODE: value })).toEqual([
        "POSTING_MODE must be anyone, invite or logged_in.",
      ]);
    }
  });
});

const OIDC = { OIDC_ISSUER: "https://id.example.org/realms/club", OIDC_CLIENT_ID: "rendezroute" };

describe("FEDIVERSE_LOGIN and FEDIVERSE_LOGIN_SERVERS (spec 7 Identity, decision D24)", () => {
  it("is off unless turned on, and then accepts any server", () => {
    expect(ok(minimal).config.fediverseLogin).toBeUndefined();
    expect(ok({ ...minimal, FEDIVERSE_LOGIN: "false" }).config.fediverseLogin).toBeUndefined();
    expect(ok({ ...minimal, FEDIVERSE_LOGIN: "true" }).config.fediverseLogin).toEqual({
      servers: undefined,
    });
  });

  it("can be limited to a list of servers, given as domains", () => {
    const limited = ok({
      ...minimal,
      FEDIVERSE_LOGIN: "true",
      FEDIVERSE_LOGIN_SERVERS: " Club.Example , mastodon.social,",
    });
    expect(limited.config.fediverseLogin).toEqual({
      servers: ["club.example", "mastodon.social"],
    });
  });

  it("refuses a server list without FEDIVERSE_LOGIN=true, and entries that are not domains", () => {
    expect(errors({ ...minimal, FEDIVERSE_LOGIN_SERVERS: "club.example" })).toEqual([
      "FEDIVERSE_LOGIN_SERVERS needs FEDIVERSE_LOGIN=true.",
    ]);
    expect(
      errors({
        ...minimal,
        FEDIVERSE_LOGIN: "true",
        FEDIVERSE_LOGIN_SERVERS: "club.example, https://x.example/path, 10.0.0.1",
      }),
    ).toEqual([
      'FEDIVERSE_LOGIN_SERVERS must list domains such as mastodon.social, got "https://x.example/path".',
      'FEDIVERSE_LOGIN_SERVERS must list domains such as mastodon.social, got "10.0.0.1".',
    ]);
  });

  it("refuses a list without domains, and takes local servers with ports in development", () => {
    expect(errors({ ...minimal, FEDIVERSE_LOGIN: "true", FEDIVERSE_LOGIN_SERVERS: " , " })).toEqual(
      ["FEDIVERSE_LOGIN_SERVERS must list at least one domain."],
    );
    const dev = ok({
      ...minimal,
      BASE_URL: "http://localhost:3000",
      ALLOW_INSECURE_DEV: "true",
      FEDIVERSE_LOGIN: "true",
      FEDIVERSE_LOGIN_SERVERS: "localhost:9001",
    });
    expect(dev.config.fediverseLogin).toEqual({ servers: ["localhost:9001"] });
  });

  it("is a way to log in for POSTING_MODE=logged_in", () => {
    expect(
      ok({ ...minimal, FEDIVERSE_LOGIN: "true", POSTING_MODE: "logged_in" }).config.postingMode,
    ).toBe("logged_in");
  });
});

describe("OIDC_* (spec 7 Identity)", () => {
  it("is off unless an issuer and client ID are set", () => {
    expect(ok(minimal).config.oidc).toBeUndefined();
  });

  it("takes the issuer, client, optional secret and a name for the login button", () => {
    expect(ok({ ...minimal, ...OIDC }).config.oidc).toEqual({
      issuer: new URL("https://id.example.org/realms/club"),
      clientId: "rendezroute",
      clientSecret: undefined,
      name: "id.example.org",
    });
    const named = ok({
      ...minimal,
      ...OIDC,
      OIDC_CLIENT_SECRET: "s3cret",
      OIDC_NAME: "Club login",
    });
    expect(named.config.oidc).toMatchObject({ clientSecret: "s3cret", name: "Club login" });
  });

  it("needs issuer and client ID together", () => {
    expect(errors({ ...minimal, OIDC_ISSUER: OIDC.OIDC_ISSUER })).toEqual([
      "OIDC_ISSUER and OIDC_CLIENT_ID must be set together.",
    ]);
    expect(errors({ ...minimal, OIDC_CLIENT_ID: "x", OIDC_CLIENT_SECRET: "y" })).toEqual([
      "OIDC_ISSUER and OIDC_CLIENT_ID must be set together.",
    ]);
  });

  it("needs an HTTPS issuer without credentials, query or fragment, and a short name", () => {
    for (const issuer of [
      "http://id.example.org",
      "https://user:pw@id.example.org",
      "https://id.example.org/?x=1",
      "https://id.example.org/#x",
      "id.example.org",
    ]) {
      expect(errors({ ...minimal, ...OIDC, OIDC_ISSUER: issuer })).toEqual([
        expect.stringContaining("OIDC_ISSUER"),
      ]);
    }
    expect(errors({ ...minimal, ...OIDC, OIDC_NAME: "x".repeat(41) })).toEqual([
      "OIDC_NAME must be 1–40 characters.",
    ]);
  });

  it("allows a plain-HTTP issuer in development mode, for a local fake provider", () => {
    const dev = ok({
      ...minimal,
      ...OIDC,
      BASE_URL: "http://localhost:3000",
      ALLOW_INSECURE_DEV: "true",
      OIDC_ISSUER: "http://localhost:9000",
    });
    expect(dev.config.oidc?.issuer.href).toBe("http://localhost:9000/");
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

  it("must not contain credentials", () => {
    expect(errors({ ...minimal, BASE_URL: "https://user:pw@runs.example.org" })).toEqual([
      expect.stringContaining("credentials"),
    ]);
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

  it("rejects UTC offsets, which are not IANA zones", () => {
    for (const zone of ["+01:00", "-0530"]) {
      expect(errors({ ...minimal, DEFAULT_TIMEZONE: zone })).toEqual([
        expect.stringContaining("DEFAULT_TIMEZONE"),
      ]);
    }
  });

  it("canonicalizes zone names", () => {
    expect(ok({ ...minimal, DEFAULT_TIMEZONE: "utc" }).config.defaultTimezone).toBe("UTC");
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
    expect(config.maps.tileHost).toBe("*.tiles.example.org");
  });

  it("wildcards the whole first host label when it contains {s}", () => {
    const { config } = ok({
      ...minimal,
      MAP_TILE_URL: "https://tiles-{s}.example.com/{z}/{x}/{y}.png",
    });
    expect(config.maps.tileCspSource).toBe("https://*.example.com");
  });

  it("keeps a port in the CSP source", () => {
    const { config } = ok({
      ...minimal,
      MAP_TILE_URL: "https://{s}.tiles.example.org:8443/{z}/{x}/{y}.png",
    });
    expect(config.maps.tileCspSource).toBe("https://*.tiles.example.org:8443");
  });

  it("rejects {s} outside the first host label", () => {
    expect(
      errors({ ...minimal, MAP_TILE_URL: "https://tiles.{s}.example.com/{z}/{x}/{y}.png" }),
    ).toEqual([expect.stringContaining("{s}")]);
  });

  it("rejects credentials in MAP_TILE_URL, which browsers see", () => {
    expect(
      errors({ ...minimal, MAP_TILE_URL: "https://key:secret@tiles.example.org/{z}/{x}/{y}.png" }),
    ).toEqual([expect.stringContaining("credentials")]);
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

const SMTP = { SMTP_HOST: "mail.example.org", SMTP_FROM: "runs@example.org" };

describe("SMTP_* (spec 7 Optional notification channels, decision D31)", () => {
  it("is off unless SMTP_HOST is set", () => {
    expect(ok(minimal).config.smtp).toBeUndefined();
  });

  it("uses STARTTLS on port 587 by default, without login", () => {
    expect(ok({ ...minimal, ...SMTP }).config.smtp).toEqual({
      host: "mail.example.org",
      port: 587,
      tls: "starttls",
      auth: undefined,
      from: "runs@example.org",
    });
  });

  it("takes TLS from the start on port 465, another port, and a login", () => {
    expect(
      ok({
        ...minimal,
        ...SMTP,
        SMTP_TLS: "tls",
        SMTP_USER: "runs",
        SMTP_PASSWORD: "s3cret",
      }).config.smtp,
    ).toMatchObject({ port: 465, tls: "tls", auth: { user: "runs", password: "s3cret" } });
    expect(ok({ ...minimal, ...SMTP, SMTP_PORT: "2525" }).config.smtp?.port).toBe(2525);
  });

  it("refuses incomplete or invalid settings", () => {
    expect(errors({ ...minimal, SMTP_FROM: "runs@example.org" })).toEqual([
      "SMTP_FROM, SMTP_PORT, SMTP_TLS, SMTP_USER and SMTP_PASSWORD need SMTP_HOST.",
    ]);
    expect(errors({ ...minimal, SMTP_HOST: "mail.example.org" })).toEqual([
      "SMTP_FROM is required with SMTP_HOST: the address emails are sent from.",
    ]);
    expect(errors({ ...minimal, ...SMTP, SMTP_FROM: "Runs <runs@example.org>" })).toEqual([
      'SMTP_FROM must be an email address, got "Runs <runs@example.org>".',
    ]);
    expect(errors({ ...minimal, ...SMTP, SMTP_HOST: "smtp://mail.example.org" })).toEqual([
      'SMTP_HOST must be a host name or IP address, got "smtp://mail.example.org".',
    ]);
    for (const port of ["0", "65536", "25x"]) {
      expect(errors({ ...minimal, ...SMTP, SMTP_PORT: port })).toEqual([
        `SMTP_PORT must be a port number from 1 to 65535, got "${port}".`,
      ]);
    }
    expect(errors({ ...minimal, ...SMTP, SMTP_TLS: "ssl" })).toEqual([
      'SMTP_TLS must be starttls, tls or none, got "ssl".',
    ]);
    expect(errors({ ...minimal, ...SMTP, SMTP_USER: "runs" })).toEqual([
      "SMTP_USER and SMTP_PASSWORD must be set together.",
    ]);
  });

  it("sends without TLS only in development", () => {
    expect(errors({ ...minimal, ...SMTP, SMTP_TLS: "none" })).toEqual([
      "SMTP_TLS=none needs ALLOW_INSECURE_DEV=true (development only).",
    ]);
    expect(
      ok({
        ...minimal,
        ...SMTP,
        SMTP_TLS: "none",
        ALLOW_INSECURE_DEV: "true",
        BASE_URL: "http://localhost:3000",
      }).config.smtp,
    ).toMatchObject({ port: 25, tls: "none" });
  });
});

describe("NTFY_URL and NTFY_TOKEN (spec 7 Optional notification channels, decision D33)", () => {
  it("is off unless NTFY_URL is set", () => {
    expect(ok(minimal).config.ntfy).toBeUndefined();
  });

  it("takes the server's URL, with a path, and a token for publishing", () => {
    expect(ok({ ...minimal, NTFY_URL: "https://ntfy.example.org" }).config.ntfy).toEqual({
      url: new URL("https://ntfy.example.org/"),
      token: undefined,
    });
    expect(
      ok({ ...minimal, NTFY_URL: "https://example.org/ntfy/", NTFY_TOKEN: "tk_secret" }).config
        .ntfy,
    ).toEqual({ url: new URL("https://example.org/ntfy/"), token: "tk_secret" });
  });

  it("refuses plain http outside development, credentials, a query, and a token alone", () => {
    expect(errors({ ...minimal, NTFY_URL: "http://ntfy.example.org" })).toEqual([
      "NTFY_URL must use HTTPS unless ALLOW_INSECURE_DEV=true (development only).",
    ]);
    expect(errors({ ...minimal, NTFY_URL: "https://user:pw@ntfy.example.org" })).toEqual([
      "NTFY_URL must not contain credentials (user:password@).",
    ]);
    expect(errors({ ...minimal, NTFY_URL: "https://ntfy.example.org/?x=1" })).toEqual([
      "NTFY_URL must not contain a query or fragment.",
    ]);
    expect(errors({ ...minimal, NTFY_TOKEN: "tk_secret" })).toEqual(["NTFY_TOKEN needs NTFY_URL."]);
  });
});

const BOT = "123456789:AAH-abcdefghijklmnopqrstuvwxyz012345";

describe("TELEGRAM_BOT_TOKEN and TELEGRAM_API_URL (spec 7 Optional notification channels, D34)", () => {
  it("is off unless the bot's token is set, and uses Telegram's API by default", () => {
    expect(ok(minimal).config.telegram).toBeUndefined();
    expect(ok({ ...minimal, TELEGRAM_BOT_TOKEN: BOT }).config.telegram).toEqual({
      token: BOT,
      apiUrl: new URL("https://api.telegram.org/"),
    });
  });

  it("takes another API server, e.g. a local Bot API server", () => {
    expect(
      ok({ ...minimal, TELEGRAM_BOT_TOKEN: BOT, TELEGRAM_API_URL: "https://bot-api.example.org" })
        .config.telegram?.apiUrl,
    ).toEqual(new URL("https://bot-api.example.org/"));
  });

  it("refuses a token that is not one, an API URL alone, and plain http outside development", () => {
    expect(errors({ ...minimal, TELEGRAM_BOT_TOKEN: "secret" })).toEqual([
      "TELEGRAM_BOT_TOKEN must be a bot token from @BotFather, such as 123456:ABC-DEF….",
    ]);
    expect(errors({ ...minimal, TELEGRAM_API_URL: "https://bot-api.example.org" })).toEqual([
      "TELEGRAM_API_URL needs TELEGRAM_BOT_TOKEN.",
    ]);
    expect(
      errors({
        ...minimal,
        TELEGRAM_BOT_TOKEN: BOT,
        TELEGRAM_API_URL: "http://bot-api.example.org",
      }),
    ).toEqual([
      "TELEGRAM_API_URL must use HTTPS unless ALLOW_INSECURE_DEV=true (development only).",
    ]);
  });
});
