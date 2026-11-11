// Privacy notice (spec 5 feature 13), generated from the configuration: only services that are
// switched on are mentioned, and only features this version has.
import { LOGIN_WINDOW_MINUTES } from "../../../../domain/identity.ts";
import { ADMIN_SESSION_HOURS } from "../../../../application/admin.ts";
import type { Translate } from "../../../i18n/i18n.ts";
import { type Config, loginConfigured } from "../../../../config.ts";
import {
  ACCOUNT_UNUSED_DAYS,
  BACKUP_DAYS,
  DEVICE_UNLINKED_DAYS,
  DEVICE_UNUSED_DAYS,
} from "../../../../domain/expiry.ts";
import { RETENTION_DAYS_LIMIT } from "../../../../domain/schedule.ts";
import { SERVICE_CACHE_DAYS, WEATHER_CACHE_MINUTES } from "../../../out/cache-lifetime.ts";
import { LONG_COOKIE_DAYS } from "../cookie-lifetime.ts";

export function PrivacyPage({
  t,
  config,
  adminLogin,
}: {
  t: Translate;
  config: Config;
  /** Instance admin login is configured, and with it reports (spec 7 Moderation). */
  adminLogin: boolean;
}) {
  const { maps, geocoder, weather } = config;
  // Each topic in its own part, divided by hairlines (decision D27).
  return (
    <section class="privacy sectioned">
      <h1>{t("privacy.title")}</h1>
      <p>{t("privacy.intro", { instance: config.instanceName })}</p>
      {config.contactEmail !== undefined && (
        <p>
          {t("privacy.contact")} <a href={`mailto:${config.contactEmail}`}>{config.contactEmail}</a>
        </p>
      )}

      <section>
        <h2>{t("privacy.storedHeading")}</h2>
        <p>{t("privacy.storedPlans")}</p>
        <p>{t("privacy.storedResponses")}</p>
        <p>{t("privacy.storedRecap")}</p>
        <p>{t("privacy.ratings")}</p>
        <p>{t("privacy.templates")}</p>
        {config.smtp !== undefined && <p>{t("privacy.email")}</p>}
        {config.ntfy !== undefined && <p>{t("privacy.ntfy", { server: config.ntfy.url.host })}</p>}
        {config.telegram !== undefined && <p>{t("privacy.telegram")}</p>}
        {config.smtp !== undefined && loginConfigured(config) && <p>{t("privacy.accountEmail")}</p>}
        {adminLogin && <p>{t("privacy.reports")}</p>}
        {config.postingMode === "invite" && <p>{t("privacy.invites")}</p>}
        <p>{t("privacy.noTracking")}</p>
        <p>
          {t("privacy.myData")} <a href="/my-data">{t("myData.heading")}</a>
        </p>
      </section>

      <section>
        <h2>{t("privacy.durationHeading")}</h2>
        <p>
          {t("privacy.retention", { days: config.maxRetentionDays })}
          {/* Existing plans keep a period promised before the maximum was lowered (decision D9). */}
          {config.maxRetentionDays < RETENTION_DAYS_LIMIT &&
            ` ${t("privacy.retentionLowered", { max: RETENTION_DAYS_LIMIT })}`}
        </p>
        <p>
          {t("privacy.devices", {
            unlinkedDays: DEVICE_UNLINKED_DAYS,
            unusedDays: DEVICE_UNUSED_DAYS,
          })}
        </p>
        {loginConfigured(config) && (
          <p>{t("privacy.accountExpiry", { days: ACCOUNT_UNUSED_DAYS })}</p>
        )}
        <p>{t("privacy.backups", { days: BACKUP_DAYS })}</p>
      </section>

      <section>
        <h2>{t("privacy.operatorHeading")}</h2>
        <p>{t("privacy.operator")}</p>
      </section>

      <section>
        <h2>{t("privacy.cookiesHeading")}</h2>
        <ul>
          <li>{t("privacy.cookieDevice", { days: LONG_COOKIE_DAYS })}</li>
          <li>{t("privacy.cookieCsrf")}</li>
          <li>{t("privacy.cookiePreferences", { days: LONG_COOKIE_DAYS })}</li>
          {adminLogin && <li>{t("privacy.cookieAdmin", { hours: ADMIN_SESSION_HOURS })}</li>}
          {loginConfigured(config) && (
            <li>{t("privacy.cookieLogin", { minutes: LOGIN_WINDOW_MINUTES })}</li>
          )}
        </ul>
        <p>{t("privacy.cookieOthers")}</p>
      </section>

      <section>
        <h2>{t("privacy.servicesHeading")}</h2>
        <ul>
          {maps.enabled && <li>{t("privacy.tiles", { host: maps.tileHost })}</li>}
          {maps.serverSideTiles && <li>{t("privacy.tilesServer")}</li>}
          {geocoder.enabled && (
            <li>{t("privacy.geocoder", { host: geocoder.url.host, days: SERVICE_CACHE_DAYS })}</li>
          )}
          {config.oidc !== undefined && (
            <li>{t("privacy.oidc", { name: config.oidc.name, host: config.oidc.issuer.host })}</li>
          )}
          {config.fediverseLogin !== undefined && <li>{t("privacy.fediverse")}</li>}
          {weather.enabled && (
            <li>
              {t("privacy.weather", { host: weather.url.host, minutes: WEATHER_CACHE_MINUTES })}
            </li>
          )}
          <li>
            {t("privacy.location")}
            {maps.enabled && ` ${t("privacy.locationMap")}`}
          </li>
          <li>{t("privacy.push")}</li>
          <li>{t("privacy.calendar")}</li>
          <li>{t("privacy.share")}</li>
          <li>{t("privacy.previews")}</li>
        </ul>
      </section>

      <section>
        <h2>{t("privacy.logsHeading")}</h2>
        <p>{t("privacy.logs")}</p>
        <p>
          {t("privacy.rateLimits")}
          {config.smtp !== undefined && ` ${t("privacy.emailRateLimit")}`}
        </p>
      </section>
    </section>
  );
}
