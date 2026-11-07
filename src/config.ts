// Loads and validates configuration (spec section 2 "Configuration", section 10).
// Takes a plain key/value record so sources other than process.env (e.g. a
// Home Assistant options file, spec section 8) can be mapped onto it later.
import { isAbsolute } from "node:path";

export type Env = Readonly<Record<string, string | undefined>>;

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
    attribution: string;
    /** Server-side tile fetching for preview images; needs CONTACT_EMAIL (provider policies). */
    serverSideTiles: boolean;
  };
  geocoder: { enabled: boolean; url: URL };
  weather: { enabled: boolean; url: URL };
  allowInsecureDev: boolean;
}

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
} as const;

const MAX_INSTANCE_NAME_LENGTH = 60;

export function loadConfig(env: Env): ConfigResult {
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

  /** Outbound service URLs must use HTTPS except in development mode. */
  const serviceUrl = (name: string, value: string, fallback: string): URL => {
    const url = httpUrl(name, value);
    if (url === undefined) return new URL(fallback);
    if (url.protocol !== "https:" && !allowInsecureDev) {
      errors.push(`${name} must use HTTPS unless ALLOW_INSECURE_DEV=true, got "${url.href}".`);
    }
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
      if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
        errors.push(
          `BASE_URL must be an origin without path, query or fragment, got "${rawBaseUrl}".`,
        );
      } else if (parsed.protocol !== "https:" && !allowInsecureDev) {
        errors.push(
          `BASE_URL must use HTTPS (set ALLOW_INSECURE_DEV=true for local development only), got "${rawBaseUrl}".`,
        );
      } else {
        baseUrl = parsed;
      }
    }
  }
  if (allowInsecureDev) {
    warnings.push(
      "ALLOW_INSECURE_DEV=true: running in development mode; cookies are not marked Secure. Never use this in production.",
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
  let defaultTimezone: string = DEFAULTS.DEFAULT_TIMEZONE;
  try {
    defaultTimezone = new Intl.DateTimeFormat("en", { timeZone: rawTimezone }).resolvedOptions()
      .timeZone;
  } catch {
    errors.push(
      `DEFAULT_TIMEZONE must be an IANA time zone such as "Europe/Berlin", got "${rawTimezone}".`,
    );
  }

  // Maps
  const mapsEnabled = bool("MAPS_ENABLED", true);
  const tileUrl = read("MAP_TILE_URL") || DEFAULTS.MAP_TILE_URL;
  let tileCspSource = "";
  if (!["{z}", "{x}", "{y}"].every((placeholder) => tileUrl.includes(placeholder))) {
    errors.push(`MAP_TILE_URL must contain {z}, {x} and {y}, got "${tileUrl}".`);
  } else {
    const parsed = serviceUrl("MAP_TILE_URL", tileUrl.replace("{s}", "s"), DEFAULTS.MAP_TILE_URL);
    tileCspSource = `${parsed.protocol}//${tileUrl.includes("{s}") ? parsed.host.replace(/^s\./, "*.") : parsed.host}`;
  }
  const attribution = read("MAP_ATTRIBUTION") ?? DEFAULTS.MAP_ATTRIBUTION;
  if (mapsEnabled && attribution === "") {
    errors.push(
      "MAP_ATTRIBUTION must not be empty while maps are enabled (tile providers require attribution).",
    );
  }

  // Geocoder and weather
  const geocoderWanted = bool("GEOCODER_ENABLED", true);
  const geocoderUrl = serviceUrl(
    "GEOCODER_URL",
    read("GEOCODER_URL") || DEFAULTS.GEOCODER_URL,
    DEFAULTS.GEOCODER_URL,
  );
  const weatherEnabled = bool("WEATHER_ENABLED", true);
  const weatherUrl = serviceUrl(
    "WEATHER_URL",
    read("WEATHER_URL") || DEFAULTS.WEATHER_URL,
    DEFAULTS.WEATHER_URL,
  );

  if (contactEmail === undefined) {
    const disabled = [
      geocoderWanted && "geocoding",
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

  if (errors.length > 0) return { ok: false, errors };

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
        attribution,
        serverSideTiles: mapsEnabled && contactEmail !== undefined,
      },
      geocoder: { enabled: geocoderWanted && contactEmail !== undefined, url: geocoderUrl },
      weather: { enabled: weatherEnabled, url: weatherUrl },
      allowInsecureDev,
    },
  };
}
