// Loads and validates configuration (spec section 2 "Configuration", section 10).
// Takes a plain key/value record so sources other than process.env (e.g. a
// Home Assistant options file, spec section 8) can be mapped onto it later.
import { isAbsolute } from "node:path";
import { parseEmailAddress } from "./domain/email.ts";
import { parseFediverseServer } from "./domain/fediverse.ts";
import { POSTING_MODES, type PostingMode } from "./domain/invite.ts";
import { validateTimeZone } from "./domain/timezone.ts";

/** Raw key/value configuration, e.g. process.env or a mapped Home Assistant options file. */
export type ConfigSource = Readonly<Record<string, string | undefined>>;

export interface Config {
  baseUrl: URL;
  instanceName: string;
  dataDir: string;
  /** Explicit override; otherwise resolved at startup from the key directory (spec 3.11). */
  encryptionKeyFile: string | undefined;
  trustProxy: boolean;
  contactEmail: string | undefined;
  imprintUrl: URL | undefined;
  privacyUrl: URL | undefined;
  maxRetentionDays: number;
  maxPlanHorizonDays: number;
  defaultTimezone: string;
  maps: {
    enabled: boolean;
    tileUrl: string;
    /** Origin for the CSP `img-src` directive; `{s}` subdomains become `*`. */
    tileCspSource: string;
    /** Host of the tile provider for people, e.g. "tile.openstreetmap.org" or "*.tiles.example.org". */
    tileHost: string;
    attribution: string;
    /** Server-side tile fetching for preview images; needs CONTACT_EMAIL (provider policies). */
    serverSideTiles: boolean;
  };
  geocoder: { enabled: boolean; url: URL };
  weather: { enabled: boolean; url: URL };
  allowInsecureDev: boolean;
  /** The instance admin's login secret (spec 7 Moderation); admin pages exist only when set. */
  adminToken: string | undefined;
  /** Who may create plans (spec 7 Moderation). */
  postingMode: PostingMode;
  /** Login with an OpenID Connect provider (spec 7 Identity); off unless configured. */
  oidc: OidcConfig | undefined;
  /** Login with a fediverse account (decision D24); off unless FEDIVERSE_LOGIN=true. */
  fediverseLogin: { servers: readonly string[] | undefined } | undefined;
  /** Sending email (spec 7 Optional notification channels, decision D31); off unless SMTP_HOST. */
  smtp: SmtpConfig | undefined;
  /** The instance's ntfy server (decision D33); off unless NTFY_URL. Trusted configuration. */
  ntfy: { url: URL; token: string | undefined } | undefined;
  /** The instance's Telegram bot (decision D34); off unless TELEGRAM_BOT_TOKEN. */
  telegram: { token: string; apiUrl: URL } | undefined;
}

export interface SmtpConfig {
  host: string;
  port: number;
  /** "starttls": STARTTLS required; "tls": TLS from the start; "none": development only. */
  tls: SmtpTls;
  auth: { user: string; password: string } | undefined;
  /** The address emails are sent from; the instance name is its display name. */
  from: string;
}

const SMTP_TLS_MODES = ["starttls", "tls", "none"] as const;
type SmtpTls = (typeof SMTP_TLS_MODES)[number];
const SMTP_DEFAULT_PORTS: Readonly<Record<SmtpTls, number>> = { starttls: 587, tls: 465, none: 25 };

export interface OidcConfig {
  issuer: URL;
  clientId: string;
  /** Without one, the client is public and relies on PKCE alone. */
  clientSecret: string | undefined;
  /** Shown on the login button and in the privacy notice. */
  name: string;
}

/** Whether any way to log in is configured (spec 7 Identity). */
export const loginConfigured = (config: Config): boolean =>
  config.oidc !== undefined || config.fediverseLogin !== undefined;

export type ConfigResult =
  | { ok: true; config: Config; warnings: string[] }
  | { ok: false; errors: string[] };

const DEFAULTS = {
  INSTANCE_NAME: "RendezRoute",
  DATA_DIR: "/data",
  MAX_RETENTION_DAYS: 30,
  MAX_PLAN_HORIZON_DAYS: 180,
  DEFAULT_TIMEZONE: "UTC",
  MAP_TILE_URL: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  MAP_ATTRIBUTION: "© OpenStreetMap contributors",
  GEOCODER_URL: "https://nominatim.openstreetmap.org",
  WEATHER_URL: "https://api.open-meteo.com",
  TELEGRAM_API_URL: "https://api.telegram.org",
} as const;

const MAX_INSTANCE_NAME_LENGTH = 60;
const MIN_ADMIN_TOKEN_LENGTH = 32;
const MAX_OIDC_NAME_LENGTH = 40;

export function loadConfig(env: ConfigSource): ConfigResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const read = (name: string): string | undefined => {
    const value = env[name];
    return value === undefined ? undefined : value.trim();
  };

  const bool = (name: string, fallback: boolean): boolean => {
    const value = read(name);
    if (value === undefined) return fallback;
    if (value === "true") return true;
    if (value === "false") return false;
    errors.push(`${name} must be "true" or "false", got "${value}".`);
    return fallback;
  };

  const lowerableLimit = (name: string, max: number): number => {
    const value = read(name);
    if (value === undefined) return max;
    const parsed = /^\d+$/.test(value) ? Number(value) : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
      errors.push(
        `${name} must be a whole number from 1 to ${max} (it may only be lowered), got "${value}".`,
      );
      return max;
    }
    return parsed;
  };

  const absolutePath = (name: string, fallback?: string): string | undefined => {
    const value = read(name) || fallback;
    if (value !== undefined && !isAbsolute(value)) {
      errors.push(`${name} must be an absolute path, got "${value}".`);
    }
    return value;
  };

  const httpUrl = (name: string, value: string | undefined): URL | undefined => {
    if (value === undefined || value === "") return undefined;
    const url = URL.parse(value);
    if (url === null || (url.protocol !== "https:" && url.protocol !== "http:")) {
      errors.push(`${name} must be an http(s) URL, got "${value}".`);
      return undefined;
    }
    return url;
  };

  const allowInsecureDev = bool("ALLOW_INSECURE_DEV", false);

  /** URLs this instance serves or calls must use HTTPS, except in development mode. */
  const requireHttps = (name: string, url: URL): boolean => {
    if (url.protocol === "https:" || allowInsecureDev) return true;
    errors.push(`${name} must use HTTPS unless ALLOW_INSECURE_DEV=true (development only).`);
    return false;
  };

  const rejectCredentials = (name: string, url: URL): boolean => {
    if (url.username === "" && url.password === "") return true;
    errors.push(`${name} must not contain credentials (user:password@).`);
    return false;
  };

  /** Outbound service URL from the environment, or the default. */
  const serviceUrl = (name: string, fallback: string): URL => {
    const url = httpUrl(name, read(name) || fallback);
    if (url === undefined) return new URL(fallback);
    requireHttps(name, url);
    return url;
  };

  // BASE_URL
  let baseUrl = new URL("https://invalid.invalid");
  const rawBaseUrl = read("BASE_URL");
  if (!rawBaseUrl) {
    errors.push(
      "BASE_URL is required: the public URL of this instance, e.g. https://runs.example.org.",
    );
  } else {
    const parsed = httpUrl("BASE_URL", rawBaseUrl);
    if (parsed !== undefined) {
      const isOrigin = parsed.pathname === "/" && parsed.search === "" && parsed.hash === "";
      if (!isOrigin) {
        errors.push(
          `BASE_URL must be an origin without path, query or fragment, got "${rawBaseUrl}".`,
        );
      } else if (rejectCredentials("BASE_URL", parsed) && requireHttps("BASE_URL", parsed)) {
        baseUrl = parsed;
      }
    }
  }
  if (allowInsecureDev) {
    warnings.push(
      "ALLOW_INSECURE_DEV=true: running in development mode; cookies are not marked Secure and " +
        "outbound requests may use http and private networks. Never use this in production.",
    );
  }

  // INSTANCE_NAME
  const instanceName = read("INSTANCE_NAME") ?? DEFAULTS.INSTANCE_NAME;
  if (instanceName.length < 1 || instanceName.length > MAX_INSTANCE_NAME_LENGTH) {
    errors.push(`INSTANCE_NAME must be 1 to ${MAX_INSTANCE_NAME_LENGTH} characters.`);
  }

  // Paths
  const dataDir = absolutePath("DATA_DIR", DEFAULTS.DATA_DIR) ?? DEFAULTS.DATA_DIR;
  const encryptionKeyFile = absolutePath("ENCRYPTION_KEY_FILE");

  // CONTACT_EMAIL
  const contactEmail = read("CONTACT_EMAIL") || undefined;
  if (contactEmail !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    errors.push(`CONTACT_EMAIL must be an email address, got "${contactEmail}".`);
  }

  // DEFAULT_TIMEZONE
  const rawTimezone = read("DEFAULT_TIMEZONE") || DEFAULTS.DEFAULT_TIMEZONE;
  const timezone = validateTimeZone(rawTimezone);
  if (!timezone.ok) {
    errors.push(
      `DEFAULT_TIMEZONE must be an IANA time zone such as "Europe/Berlin", got "${rawTimezone}".`,
    );
  }
  const defaultTimezone = timezone.ok ? timezone.value : DEFAULTS.DEFAULT_TIMEZONE;

  // Maps
  const mapsEnabled = bool("MAPS_ENABLED", true);
  const tileUrl = read("MAP_TILE_URL") || DEFAULTS.MAP_TILE_URL;
  const tileCspSource = tileSource(tileUrl);
  const attribution = read("MAP_ATTRIBUTION") ?? DEFAULTS.MAP_ATTRIBUTION;
  if (mapsEnabled && attribution === "") {
    errors.push(
      "MAP_ATTRIBUTION must not be empty while maps are enabled (tile providers require attribution).",
    );
  }

  /** Validates MAP_TILE_URL and returns its CSP img-src source; `{s}` in the first host label becomes `*`. */
  function tileSource(template: string): string {
    if (!["{z}", "{x}", "{y}"].every((placeholder) => template.includes(placeholder))) {
      errors.push(`MAP_TILE_URL must contain {z}, {x} and {y}, got "${template}".`);
      return "";
    }
    const host = /^[a-z]+:\/\/(?:[^@/]*@)?([^/]+)/i.exec(template)?.[1] ?? "";
    const [firstLabel = "", ...otherLabels] = host.split(".");
    if (otherLabels.some((label) => label.includes("{s}"))) {
      errors.push(
        "MAP_TILE_URL may use {s} only in the first host label, e.g. https://{s}.tiles.example.org.",
      );
      return "";
    }
    const parsed = httpUrl("MAP_TILE_URL", template.replaceAll("{s}", "a"));
    if (parsed === undefined || !rejectCredentials("MAP_TILE_URL", parsed)) return "";
    requireHttps("MAP_TILE_URL", parsed);
    const cspHost = firstLabel.includes("{s}") ? ["*", ...otherLabels].join(".") : host;
    return `${parsed.protocol}//${cspHost}`;
  }

  // Geocoder and weather. The geocoder setting is effective only with CONTACT_EMAIL.
  const geocoderSetting = bool("GEOCODER_ENABLED", true);
  const geocoderUrl = serviceUrl("GEOCODER_URL", DEFAULTS.GEOCODER_URL);
  const weatherEnabled = bool("WEATHER_ENABLED", true);
  const weatherUrl = serviceUrl("WEATHER_URL", DEFAULTS.WEATHER_URL);

  if (contactEmail === undefined) {
    const disabled = [
      geocoderSetting && "geocoding",
      mapsEnabled && "server-side tile fetching",
    ].filter(Boolean);
    if (disabled.length > 0) {
      warnings.push(
        `CONTACT_EMAIL is not set: ${disabled.join(" and ")} disabled, because provider policies require identification.`,
      );
    }
  }

  // Imprint and privacy links
  const imprintUrl = httpUrl("IMPRINT_URL", read("IMPRINT_URL"));
  const privacyUrl = httpUrl("PRIVACY_URL", read("PRIVACY_URL"));

  const maxRetentionDays = lowerableLimit("MAX_RETENTION_DAYS", DEFAULTS.MAX_RETENTION_DAYS);
  const maxPlanHorizonDays = lowerableLimit(
    "MAX_PLAN_HORIZON_DAYS",
    DEFAULTS.MAX_PLAN_HORIZON_DAYS,
  );
  const trustProxy = bool("TRUST_PROXY", false);

  // ADMIN_TOKEN: at least 32 characters, or the app refuses to start (spec 7 Moderation).
  const adminToken = read("ADMIN_TOKEN") || undefined;
  if (adminToken !== undefined && adminToken.length < MIN_ADMIN_TOKEN_LENGTH) {
    errors.push(`ADMIN_TOKEN must be at least ${MIN_ADMIN_TOKEN_LENGTH} characters.`);
  }

  // OIDC_*: issuer and client ID together; the issuer is trusted configuration (decision D23).
  const oidc = ((): OidcConfig | undefined => {
    const issuerSetting = read("OIDC_ISSUER") || undefined;
    const clientId = read("OIDC_CLIENT_ID") || undefined;
    if (issuerSetting === undefined && clientId === undefined) return undefined;
    if (issuerSetting === undefined || clientId === undefined) {
      errors.push("OIDC_ISSUER and OIDC_CLIENT_ID must be set together.");
      return undefined;
    }
    const issuer = httpUrl("OIDC_ISSUER", issuerSetting);
    if (issuer === undefined || !rejectCredentials("OIDC_ISSUER", issuer)) return undefined;
    if (issuer.search !== "" || issuer.hash !== "") {
      errors.push("OIDC_ISSUER must not contain a query or fragment.");
      return undefined;
    }
    if (!requireHttps("OIDC_ISSUER", issuer)) return undefined;
    const name = read("OIDC_NAME") || issuer.hostname;
    if (Array.from(name).length > MAX_OIDC_NAME_LENGTH) {
      errors.push(`OIDC_NAME must be 1–${MAX_OIDC_NAME_LENGTH} characters.`);
    }
    return { issuer, clientId, clientSecret: read("OIDC_CLIENT_SECRET") || undefined, name };
  })();

  // FEDIVERSE_LOGIN: off unless turned on; FEDIVERSE_LOGIN_SERVERS limits the servers (decision D24).
  const fediverseOn = bool("FEDIVERSE_LOGIN", false);
  const serverList = read("FEDIVERSE_LOGIN_SERVERS") || undefined;
  if (serverList !== undefined && !fediverseOn) {
    errors.push("FEDIVERSE_LOGIN_SERVERS needs FEDIVERSE_LOGIN=true.");
  }
  // Domains; in development also local fake servers with a port (host:port).
  const servers = serverList
    ?.split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .flatMap((entry) => {
      const parsed = parseFediverseServer(entry, { allowInsecure: allowInsecureDev });
      const host = parsed.ok ? new URL(parsed.value).host : undefined;
      if (host === undefined || host !== entry.toLowerCase().replace(/\.$/, "")) {
        errors.push(
          `FEDIVERSE_LOGIN_SERVERS must list domains such as mastodon.social, got "${entry}".`,
        );
        return [];
      }
      return [host];
    });
  if (serverList !== undefined && servers?.length === 0) {
    errors.push("FEDIVERSE_LOGIN_SERVERS must list at least one domain.");
  }
  const fediverseLogin = fediverseOn ? { servers } : undefined;

  // POSTING_MODE: invite links come from the admin page, so invite needs ADMIN_TOKEN; logged_in
  // needs a way to log in.
  const postingSetting = read("POSTING_MODE") || "anyone";
  const postingMode = (POSTING_MODES as readonly string[]).includes(postingSetting)
    ? (postingSetting as PostingMode)
    : undefined;
  if (postingMode === undefined) errors.push("POSTING_MODE must be anyone, invite or logged_in.");
  if (postingMode === "invite" && adminToken === undefined) {
    errors.push(
      "POSTING_MODE=invite needs ADMIN_TOKEN: only the instance admin can create invite links.",
    );
  }
  if (
    postingMode === "logged_in" &&
    oidc === undefined &&
    !read("OIDC_ISSUER") &&
    fediverseLogin === undefined
  ) {
    errors.push(
      "POSTING_MODE=logged_in needs a way to log in: set OIDC_ISSUER and OIDC_CLIENT_ID, or FEDIVERSE_LOGIN=true.",
    );
  }

  // SMTP_*: the mail server is trusted configuration, like the OIDC issuer (decision D31).
  const smtp = ((): SmtpConfig | undefined => {
    const host = read("SMTP_HOST") || undefined;
    const others = ["SMTP_FROM", "SMTP_PORT", "SMTP_TLS", "SMTP_USER", "SMTP_PASSWORD"];
    if (host === undefined) {
      if (others.some((name) => read(name))) {
        errors.push(`${others.slice(0, -1).join(", ")} and ${others.at(-1)} need SMTP_HOST.`);
      }
      return undefined;
    }
    if (!/^[A-Za-z0-9.-]+$|^\[[0-9A-Fa-f:.]+\]$/.test(host)) {
      errors.push(`SMTP_HOST must be a host name or IP address, got "${host}".`);
    }
    const from = read("SMTP_FROM") || undefined;
    if (from === undefined) {
      errors.push("SMTP_FROM is required with SMTP_HOST: the address emails are sent from.");
    } else if (!parseEmailAddress(from).ok) {
      errors.push(`SMTP_FROM must be an email address, got "${from}".`);
    }
    const tlsSetting = read("SMTP_TLS") || "starttls";
    const tls = SMTP_TLS_MODES.find((mode) => mode === tlsSetting);
    if (tls === undefined) {
      errors.push(`SMTP_TLS must be starttls, tls or none, got "${tlsSetting}".`);
    } else if (tls === "none" && !allowInsecureDev) {
      errors.push("SMTP_TLS=none needs ALLOW_INSECURE_DEV=true (development only).");
    }
    const portSetting = read("SMTP_PORT");
    const port =
      portSetting === undefined || portSetting === ""
        ? SMTP_DEFAULT_PORTS[tls ?? "starttls"]
        : /^\d+$/.test(portSetting)
          ? Number(portSetting)
          : Number.NaN;
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      errors.push(`SMTP_PORT must be a port number from 1 to 65535, got "${portSetting}".`);
    }
    const user = read("SMTP_USER") || undefined;
    const password = read("SMTP_PASSWORD") || undefined;
    if ((user === undefined) !== (password === undefined)) {
      errors.push("SMTP_USER and SMTP_PASSWORD must be set together.");
    }
    return {
      host,
      port,
      tls: tls ?? "starttls",
      auth: user === undefined || password === undefined ? undefined : { user, password },
      from: from ?? "",
    };
  })();

  // NTFY_URL: the server notifications are posted to, maybe behind a path (decision D33).
  const ntfy = ((): Config["ntfy"] => {
    const setting = read("NTFY_URL") || undefined;
    const token = read("NTFY_TOKEN") || undefined;
    if (setting === undefined) {
      if (token !== undefined) errors.push("NTFY_TOKEN needs NTFY_URL.");
      return undefined;
    }
    const url = httpUrl("NTFY_URL", setting);
    if (url === undefined || !rejectCredentials("NTFY_URL", url)) return undefined;
    if (url.search !== "" || url.hash !== "") {
      errors.push("NTFY_URL must not contain a query or fragment.");
      return undefined;
    }
    if (!requireHttps("NTFY_URL", url)) return undefined;
    return { url, token };
  })();

  // TELEGRAM_BOT_TOKEN: the bot from @BotFather; TELEGRAM_API_URL for a local Bot API server.
  const telegram = ((): Config["telegram"] => {
    const token = read("TELEGRAM_BOT_TOKEN") || undefined;
    const apiSetting = read("TELEGRAM_API_URL") || undefined;
    if (token === undefined) {
      if (apiSetting !== undefined) errors.push("TELEGRAM_API_URL needs TELEGRAM_BOT_TOKEN.");
      return undefined;
    }
    if (!/^\d{1,20}:[A-Za-z0-9_-]{30,}$/.test(token)) {
      errors.push(
        "TELEGRAM_BOT_TOKEN must be a bot token from @BotFather, such as 123456:ABC-DEF….",
      );
      return undefined;
    }
    const apiUrl = httpUrl("TELEGRAM_API_URL", apiSetting ?? DEFAULTS.TELEGRAM_API_URL);
    if (apiUrl === undefined || !rejectCredentials("TELEGRAM_API_URL", apiUrl)) return undefined;
    if (!requireHttps("TELEGRAM_API_URL", apiUrl)) return undefined;
    return { token, apiUrl };
  })();

  if (errors.length > 0 || postingMode === undefined) return { ok: false, errors };

  return {
    ok: true,
    warnings,
    config: {
      baseUrl,
      instanceName,
      dataDir,
      encryptionKeyFile,
      trustProxy,
      contactEmail,
      imprintUrl,
      privacyUrl,
      maxRetentionDays,
      maxPlanHorizonDays,
      defaultTimezone,
      maps: {
        enabled: mapsEnabled,
        tileUrl,
        tileCspSource,
        tileHost: tileCspSource.replace(/^[a-z]+:\/\//i, ""),
        attribution,
        serverSideTiles: mapsEnabled && contactEmail !== undefined,
      },
      geocoder: { enabled: geocoderSetting && contactEmail !== undefined, url: geocoderUrl },
      weather: { enabled: weatherEnabled, url: weatherUrl },
      allowInsecureDev,
      adminToken,
      postingMode,
      oidc,
      fediverseLogin,
      smtp,
      ntfy,
      telegram,
    },
  };
}
