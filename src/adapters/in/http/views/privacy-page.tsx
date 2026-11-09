// Privacy notice (spec 5 feature 13), generated from the configuration: only services that are
// switched on are mentioned, and only features this version has.
import type { Translate } from "../../../i18n/i18n.ts";
import type { Config } from "../../../../config.ts";
import {
  BACKUP_DAYS,
  DEVICE_UNLINKED_DAYS,
  DEVICE_UNUSED_DAYS,
} from "../../../../domain/expiry.ts";
import { RETENTION_DAYS_LIMIT } from "../../../../domain/schedule.ts";
import { SERVICE_CACHE_DAYS, WEATHER_CACHE_MINUTES } from "../../../out/cache-lifetime.ts";
import { LONG_COOKIE_DAYS } from "../cookie-lifetime.ts";

export function PrivacyPage({ t, config }: { t: Translate; config: Config }) {
  const { maps, geocoder, weather } = config;
  return (
    <section class="privacy">
      <h1>{t("privacy.title")}</h1>
      <p>{t("privacy.intro", { instance: config.instanceName })}</p>
      {config.contactEmail !== undefined && (
        <p>
          {t("privacy.contact")} <a href={`mailto:${config.contactEmail}`}>{config.contactEmail}</a>
        </p>
      )}

      <h2>{t("privacy.storedHeading")}</h2>
      <p>{t("privacy.storedPlans")}</p>
      <p>{t("privacy.storedResponses")}</p>
      <p>{t("privacy.storedRecap")}</p>
      <p>{t("privacy.templates")}</p>
      <p>{t("privacy.noTracking")}</p>
      <p>
        {t("privacy.myData")} <a href="/my-data">{t("myData.heading")}</a>
      </p>

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
      <p>{t("privacy.backups", { days: BACKUP_DAYS })}</p>

      <h2>{t("privacy.operatorHeading")}</h2>
      <p>{t("privacy.operator")}</p>

      <h2>{t("privacy.cookiesHeading")}</h2>
      <ul>
        <li>{t("privacy.cookieDevice", { days: LONG_COOKIE_DAYS })}</li>
        <li>{t("privacy.cookieCsrf")}</li>
        <li>{t("privacy.cookiePreferences", { days: LONG_COOKIE_DAYS })}</li>
      </ul>
      <p>{t("privacy.cookieOthers")}</p>

      <h2>{t("privacy.servicesHeading")}</h2>
      <ul>
        {maps.enabled && <li>{t("privacy.tiles", { host: maps.tileHost })}</li>}
        {maps.serverSideTiles && <li>{t("privacy.tilesServer")}</li>}
        {geocoder.enabled && (
          <li>{t("privacy.geocoder", { host: geocoder.url.host, days: SERVICE_CACHE_DAYS })}</li>
        )}
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

      <h2>{t("privacy.logsHeading")}</h2>
      <p>{t("privacy.logs")}</p>
      <p>{t("privacy.rateLimits")}</p>
    </section>
  );
}
