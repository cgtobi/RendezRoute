// The Home Assistant app's options (decision D57) mapped to the configuration's environment. Pure:
// no files, no process, no environment. The Supervisor validates /data/options.json against the
// schema of config.yaml, so the types here are a second line of defence that names the option; the
// values themselves are checked by loadConfig, which is the one place the rules live.
export type HaOptionsResult =
  | { ok: true; env: Record<string, string> }
  | { ok: false; errors: string[] };

export type HaOptionKind = "text" | "flag" | "integer" | "list";

/** option name (as the Home Assistant form shows it) -> [environment name, kind of value]. */
const OPTIONS: Readonly<Record<string, readonly [string, HaOptionKind]>> = {
  base_url: ["BASE_URL", "text"],
  instance_name: ["INSTANCE_NAME", "text"],
  contact_email: ["CONTACT_EMAIL", "text"],
  imprint_url: ["IMPRINT_URL", "text"],
  privacy_url: ["PRIVACY_URL", "text"],
  default_timezone: ["DEFAULT_TIMEZONE", "text"],
  maps_enabled: ["MAPS_ENABLED", "flag"],
  map_tile_url: ["MAP_TILE_URL", "text"],
  map_attribution: ["MAP_ATTRIBUTION", "text"],
  geocoder_enabled: ["GEOCODER_ENABLED", "flag"],
  geocoder_url: ["GEOCODER_URL", "text"],
  weather_enabled: ["WEATHER_ENABLED", "flag"],
  weather_url: ["WEATHER_URL", "text"],
  posting_mode: ["POSTING_MODE", "text"],
  public_requires_login: ["PUBLIC_REQUIRES_LOGIN", "flag"],
  nearby_enabled: ["NEARBY_ENABLED", "flag"],
  federation_enabled: ["FEDERATION_ENABLED", "flag"],
  oidc_issuer: ["OIDC_ISSUER", "text"],
  oidc_client_id: ["OIDC_CLIENT_ID", "text"],
  oidc_client_secret: ["OIDC_CLIENT_SECRET", "text"],
  oidc_name: ["OIDC_NAME", "text"],
  fediverse_login: ["FEDIVERSE_LOGIN", "flag"],
  fediverse_login_servers: ["FEDIVERSE_LOGIN_SERVERS", "list"],
  smtp_host: ["SMTP_HOST", "text"],
  smtp_port: ["SMTP_PORT", "integer"],
  smtp_tls: ["SMTP_TLS", "text"],
  smtp_user: ["SMTP_USER", "text"],
  smtp_password: ["SMTP_PASSWORD", "text"],
  smtp_from: ["SMTP_FROM", "text"],
  ntfy_url: ["NTFY_URL", "text"],
  ntfy_token: ["NTFY_TOKEN", "text"],
  telegram_bot_token: ["TELEGRAM_BOT_TOKEN", "text"],
  telegram_api_url: ["TELEGRAM_API_URL", "text"],
  max_retention_days: ["MAX_RETENTION_DAYS", "integer"],
  max_plan_horizon_days: ["MAX_PLAN_HORIZON_DAYS", "integer"],
  trust_proxy: ["TRUST_PROXY", "flag"],
};

/** The option names (the keys of the app's schema in config.yaml) and their kinds of value. */
export const HA_OPTION_KINDS: Readonly<Record<string, HaOptionKind>> = Object.fromEntries(
  Object.entries(OPTIONS).map(([option, [, kind]]) => [option, kind]),
);
export const HA_OPTION_NAMES: readonly string[] = Object.keys(OPTIONS);

/** The environment names the options write (for tests that keep them in step with config.ts). */
export const HA_OPTION_ENVIRONMENT_NAMES: readonly string[] = Object.values(OPTIONS).map(
  ([name]) => name,
);

/**
 * What the app fixes itself, never an option: the database in /data, the keys in their own
 * directory of the app's /config folder (the key directory also holds the VAPID and federation
 * keys), the admin pages only through Ingress on the Supervisor's default ingress port, reachable
 * from outside the container. ADMIN_TOKEN is never set. The public port stays 3000.
 */
export const FIXED_ENVIRONMENT: Readonly<Record<string, string>> = {
  DATA_DIR: "/data",
  ENCRYPTION_KEY_FILE: "/config/keys/field.key",
  ADMIN_INGRESS: "true",
  ADMIN_PORT: "8099",
  ADMIN_BIND: "0.0.0.0",
};

export function mapHomeAssistantOptions(options: unknown): HaOptionsResult {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    return { ok: false, errors: ["The options must be a JSON object."] };
  }
  const given = options as Record<string, unknown>;
  const env: Record<string, string> = {};
  const errors: string[] = [];
  // Errors name the option and what it needs, never its value: it may be a secret.
  for (const [option, [name, kind]] of Object.entries(OPTIONS)) {
    const value = Object.hasOwn(given, option) ? given[option] : undefined;
    if (value === undefined || value === null) continue;
    switch (kind) {
      case "text":
        if (typeof value !== "string") errors.push(`${option} must be text.`);
        else if (value.trim() !== "") env[name] = value.trim();
        break;
      case "flag":
        if (typeof value !== "boolean") errors.push(`${option} must be true or false.`);
        else env[name] = String(value);
        break;
      case "integer":
        if (typeof value !== "number" || !Number.isInteger(value)) {
          errors.push(`${option} must be a whole number.`);
        } else env[name] = String(value);
        break;
      case "list": {
        if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
          errors.push(`${option} must be a list of text entries.`);
          break;
        }
        const items = value.map((item: string) => item.trim()).filter((item) => item !== "");
        if (items.some((item) => item.includes(","))) {
          errors.push(`${option} entries must not contain a comma.`);
        } else if (items.length > 0) env[name] = items.join(",");
        break;
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, env: { ...env, ...FIXED_ENVIRONMENT } };
}
