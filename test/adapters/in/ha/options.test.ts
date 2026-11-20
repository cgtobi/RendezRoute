// The Home Assistant options mapper (decision D57): pure, maps the app's snake_case options to the
// configuration's environment names and adds the values the app fixes itself.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import {
  FIXED_ENVIRONMENT,
  HA_OPTION_ENVIRONMENT_NAMES,
  mapHomeAssistantOptions,
} from "../../../../src/adapters/in/ha/options.ts";
import { loadConfig } from "../../../../src/config.ts";

const FIXED = {
  DATA_DIR: "/data",
  ENCRYPTION_KEY_FILE: "/config/keys/field.key",
  ADMIN_INGRESS: "true",
  ADMIN_PORT: "8099",
  ADMIN_BIND: "0.0.0.0",
};

function mapped(options: unknown): Record<string, string> {
  const result = mapHomeAssistantOptions(options);
  if (!result.ok) throw new Error(`expected a mapping, got: ${result.errors.join("; ")}`);
  return result.env;
}

function errorsOf(options: unknown): string[] {
  const result = mapHomeAssistantOptions(options);
  if (result.ok) throw new Error("expected errors");
  return result.errors;
}

/** Every option with a value of its kind, and the environment name and text it must become. */
const FULL: [option: string, value: unknown, name: string, text: string][] = [
  ["base_url", "https://runs.example.org", "BASE_URL", "https://runs.example.org"],
  ["instance_name", "Run Club", "INSTANCE_NAME", "Run Club"],
  ["contact_email", "owner@example.org", "CONTACT_EMAIL", "owner@example.org"],
  ["imprint_url", "https://example.org/imprint", "IMPRINT_URL", "https://example.org/imprint"],
  ["privacy_url", "https://example.org/privacy", "PRIVACY_URL", "https://example.org/privacy"],
  ["default_timezone", "Europe/Berlin", "DEFAULT_TIMEZONE", "Europe/Berlin"],
  ["maps_enabled", false, "MAPS_ENABLED", "false"],
  ["default_map_center", "48.1374,11.5755", "DEFAULT_MAP_CENTER", "48.1374,11.5755"],
  ["default_map_zoom", 9, "DEFAULT_MAP_ZOOM", "9"],
  [
    "map_tile_url",
    "https://tiles.example/{z}/{x}/{y}.png",
    "MAP_TILE_URL",
    "https://tiles.example/{z}/{x}/{y}.png",
  ],
  ["map_attribution", "(c) Someone", "MAP_ATTRIBUTION", "(c) Someone"],
  ["geocoder_enabled", true, "GEOCODER_ENABLED", "true"],
  ["geocoder_url", "https://geo.example", "GEOCODER_URL", "https://geo.example"],
  ["weather_enabled", false, "WEATHER_ENABLED", "false"],
  ["weather_url", "https://weather.example", "WEATHER_URL", "https://weather.example"],
  ["posting_mode", "invite", "POSTING_MODE", "invite"],
  ["palette", "bold", "PALETTE", "bold"],
  ["rating_min_participants", 4, "RATING_MIN_PARTICIPANTS", "4"],
  ["public_requires_login", true, "PUBLIC_REQUIRES_LOGIN", "true"],
  ["nearby_enabled", false, "NEARBY_ENABLED", "false"],
  ["federation_enabled", true, "FEDERATION_ENABLED", "true"],
  ["oidc_issuer", "https://sso.example.org", "OIDC_ISSUER", "https://sso.example.org"],
  ["oidc_client_id", "rendezroute", "OIDC_CLIENT_ID", "rendezroute"],
  ["oidc_client_secret", "s3cret-oidc", "OIDC_CLIENT_SECRET", "s3cret-oidc"],
  ["oidc_name", "Our SSO", "OIDC_NAME", "Our SSO"],
  ["fediverse_login", true, "FEDIVERSE_LOGIN", "true"],
  [
    "fediverse_login_servers",
    ["mastodon.social", "social.example"],
    "FEDIVERSE_LOGIN_SERVERS",
    "mastodon.social,social.example",
  ],
  ["smtp_host", "smtp.example.org", "SMTP_HOST", "smtp.example.org"],
  ["smtp_port", 465, "SMTP_PORT", "465"],
  ["smtp_tls", "tls", "SMTP_TLS", "tls"],
  ["smtp_user", "mailer", "SMTP_USER", "mailer"],
  ["smtp_password", "s3cret-smtp", "SMTP_PASSWORD", "s3cret-smtp"],
  ["smtp_from", "runs@example.org", "SMTP_FROM", "runs@example.org"],
  ["ntfy_url", "https://ntfy.example", "NTFY_URL", "https://ntfy.example"],
  ["ntfy_token", "tk_secret", "NTFY_TOKEN", "tk_secret"],
  ["telegram_bot_token", "123:secret-bot", "TELEGRAM_BOT_TOKEN", "123:secret-bot"],
  ["telegram_api_url", "https://tg.example", "TELEGRAM_API_URL", "https://tg.example"],
  ["max_retention_days", 14, "MAX_RETENTION_DAYS", "14"],
  ["max_plan_horizon_days", 90, "MAX_PLAN_HORIZON_DAYS", "90"],
  ["trust_proxy", true, "TRUST_PROXY", "true"],
];

const SECRET_OPTIONS = [
  "oidc_client_secret",
  "smtp_password",
  "ntfy_token",
  "telegram_bot_token",
] as const;

describe("mapping the options", () => {
  it("maps every option to its environment name, as text", () => {
    for (const [option, value, name, text] of FULL) {
      expect([option, mapped({ [option]: value })[name]]).toEqual([option, text]);
    }
  });

  it("covers every option of the spec exactly once", () => {
    expect(FULL.map(([option]) => option).length).toBe(40);
    expect(new Set(FULL.map(([, , name]) => name)).size).toBe(40);
    expect([...HA_OPTION_ENVIRONMENT_NAMES].sort()).toEqual(FULL.map(([, , name]) => name).sort());
  });

  it("writes the fixed values, and nothing else for an empty option set", () => {
    expect(mapped({})).toEqual(FIXED);
    expect(FIXED_ENVIRONMENT).toEqual(FIXED);
  });

  it("leaves omitted, null and empty options out, so the defaults apply", () => {
    const empty = Object.fromEntries(
      FULL.map(([option, value]) => [
        option,
        Array.isArray(value) ? [] : typeof value === "string" ? "  " : null,
      ]),
    );
    expect(mapped(empty)).toEqual(FIXED);
    expect(mapped(Object.fromEntries(FULL.map(([option]) => [option, undefined])))).toEqual(FIXED);
    expect(mapped({ fediverse_login_servers: ["", "  "] })).toEqual(FIXED);
  });

  it("treats the form's shown defaults as unset", () => {
    // contact_email, the URLs and the SMTP fields are always shown, with "" (decision I78); the
    // transport default "starttls" without a host would otherwise make the start fail.
    const shown = {
      contact_email: "",
      imprint_url: "",
      privacy_url: "",
      smtp_host: "",
      smtp_tls: "starttls",
      smtp_user: "",
      smtp_password: "",
      smtp_from: "",
    };
    expect(mapped(shown)).toEqual(FIXED);
    expect(mapped({ ...shown, smtp_host: "mail.example.org" }).SMTP_TLS).toBe("starttls");
    expect(mapped({ smtp_tls: "tls" }).SMTP_TLS).toBe("tls");
    expect("SMTP_PORT" in mapped(shown)).toBe(false);
  });

  it("keeps false and 0-like values that mean something", () => {
    const env = mapped({ maps_enabled: false, trust_proxy: false });
    expect(env.MAPS_ENABLED).toBe("false");
    expect(env.TRUST_PROXY).toBe("false");
  });

  it("trims text and list entries", () => {
    const env = mapped({
      instance_name: "  Run Club ",
      fediverse_login_servers: [" a.example ", ""],
    });
    expect(env.INSTANCE_NAME).toBe("Run Club");
    expect(env.FEDIVERSE_LOGIN_SERVERS).toBe("a.example");
  });

  it("ignores unknown keys without an error", () => {
    const env = mapped({ whatever: 1, log_level: "debug", allow_insecure_dev: true });
    expect(env).toEqual(FIXED);
  });

  it("never takes ADMIN_TOKEN or the fixed settings from the options", () => {
    const env = mapped({
      admin_token: "x".repeat(40),
      ADMIN_TOKEN: "x".repeat(40),
      admin_port: 1,
      admin_bind: "127.0.0.1",
      admin_ingress: false,
      data_dir: "/elsewhere",
      encryption_key_file: "/elsewhere/key",
      ADMIN_PORT: "1",
    });
    expect(env).toEqual(FIXED);
    expect("ADMIN_TOKEN" in env).toBe(false);
  });

  it("does not touch the environment of the process or its input", () => {
    const options = { base_url: "https://runs.example.org", fediverse_login_servers: ["a"] };
    const copy = structuredClone(options);
    mapped(options);
    expect(options).toEqual(copy);
  });
});

describe("wrong types", () => {
  it("names the option for each wrong type", () => {
    const wrong: [string, unknown][] = [
      ["base_url", 5],
      ["instance_name", true],
      ["maps_enabled", "yes"],
      ["trust_proxy", 1],
      ["smtp_port", "465"],
      ["smtp_port", 465.5],
      ["max_retention_days", Number.NaN],
      ["max_retention_days", Number.POSITIVE_INFINITY],
      ["fediverse_login_servers", "a.example"],
      ["fediverse_login_servers", [1]],
      ["fediverse_login_servers", ["a,b"]],
      ["smtp_host", { x: 1 }],
      ["smtp_tls", ["tls"]],
    ];
    for (const [option, value] of wrong) {
      const errors = errorsOf({ [option]: value });
      expect([option, errors.length, errors[0]?.startsWith(`${option} `)]).toEqual([
        option,
        1,
        true,
      ]);
    }
  });

  it("reports every wrong option at once", () => {
    const errors = errorsOf({ base_url: 5, smtp_port: "x", trust_proxy: "maybe" });
    expect(errors).toHaveLength(3);
  });

  it("refuses an options file that is not an object", () => {
    for (const value of [null, undefined, [], "text", 5, true]) {
      expect(errorsOf(value)).toEqual(["The options must be a JSON object."]);
    }
  });

  it("never puts a value, secret or not, in an error", () => {
    for (const option of SECRET_OPTIONS) {
      for (const value of [12345, true, { leak: "TOPSECRET" }, ["TOPSECRET"]]) {
        const text = errorsOf({ [option]: value }).join("\n");
        expect(text).toContain(option);
        expect(text).not.toContain("TOPSECRET");
        expect(text).not.toContain("12345");
      }
    }
    const text = errorsOf({
      fediverse_login_servers: ["TOPSECRET,comma"],
      smtp_port: "TOPSECRET",
      trust_proxy: "TOPSECRET",
    }).join("\n");
    expect(text).not.toContain("TOPSECRET");
  });
});

describe("what the configuration makes of the mapped environment", () => {
  it("accepts the minimum: base_url only", () => {
    const env = mapped({ base_url: "https://runs.example.org" });
    const result = loadConfig({ ...env, SUPERVISOR_SOCKET: "/run/supervisor/api/supervisor.sock" });
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.config.admin?.ingress?.peer).toBe("172.30.32.2");
    expect(result.config.admin?.port).toBe(8099);
    expect(result.config.dataDir).toBe("/data");
    expect(result.config.encryptionKeyFile).toBe("/config/keys/field.key");
    expect(result.config.adminToken).toBeUndefined();
  });

  it("accepts a full example, with the token from the Supervisor's environment", () => {
    const env = mapped({
      base_url: "https://runs.example.org",
      instance_name: "Run Club",
      contact_email: "owner@example.org",
      imprint_url: "https://example.org/imprint",
      privacy_url: "https://example.org/privacy",
      default_timezone: "Europe/Berlin",
      default_map_center: "48.1374,11.5755",
      default_map_zoom: 9,
      maps_enabled: true,
      geocoder_enabled: true,
      weather_enabled: true,
      posting_mode: "invite",
      nearby_enabled: true,
      federation_enabled: false,
      oidc_issuer: "https://sso.example.org",
      oidc_client_id: "rendezroute",
      oidc_client_secret: "secret",
      oidc_name: "Our SSO",
      fediverse_login: true,
      fediverse_login_servers: ["mastodon.social", "social.example"],
      smtp_host: "smtp.example.org",
      smtp_port: 587,
      smtp_tls: "starttls",
      smtp_user: "mailer",
      smtp_password: "secret",
      smtp_from: "runs@example.org",
      ntfy_url: "https://ntfy.example.org",
      ntfy_token: "tk_secret",
      telegram_bot_token: "123456:ABC-DEFsecretsecretsecretsecretsecret",
      max_retention_days: 14,
      max_plan_horizon_days: 90,
      trust_proxy: false,
    });
    const result = loadConfig({ ...env, SUPERVISOR_TOKEN: "token" });
    if (!result.ok) throw new Error(result.errors.join("; "));
    expect(result.config.instanceName).toBe("Run Club");
    expect(result.config.postingMode).toBe("invite");
    expect(result.config.maxRetentionDays).toBe(14);
    expect(result.config.defaultMap).toEqual({ center: { lat: 48.1374, lng: 11.5755 }, zoom: 9 });
  });

  it("fails with the configuration's own error for an http base_url", () => {
    const env = mapped({ base_url: "http://runs.example.org" });
    const result = loadConfig({ ...env, SUPERVISOR_SOCKET: "/s.sock" });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toContain("BASE_URL");
  });

  it("does not rewrite the configuration's error for a missing base_url", () => {
    const result = loadConfig({ ...mapped({}), SUPERVISOR_SOCKET: "/s.sock" });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join(" ")).toContain("BASE_URL");
  });

  it("writes only names that config.ts reads (it cannot drift)", () => {
    const source = readFileSync(new URL("../../../../src/config.ts", import.meta.url), "utf8");
    const known = new Set(source.match(/"[A-Z][A-Z0-9_]{2,}"/g)?.map((name) => name.slice(1, -1)));
    const written = [...HA_OPTION_ENVIRONMENT_NAMES, ...Object.keys(FIXED_ENVIRONMENT)];
    expect(written.filter((name) => !known.has(name))).toEqual([]);
    expect(written.length).toBe(40 + 5);
    // Development switches are never Home Assistant options nor fixed values (decision D87).
    expect(written).not.toContain("E2E_CLOCK_CONTROL");
    expect(written).not.toContain("ALLOW_INSECURE_DEV");
  });
});
