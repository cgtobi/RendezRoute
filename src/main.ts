// Composition root (spec 2a): reads configuration and wires the enabled adapters.
import { createInstanceFederation } from "./adapters/in/activitypub/federation.ts";
import {
  actorKeyFactory,
  loadOrCreateInstanceKeys,
  type SigningKeyPair,
} from "./adapters/out/crypto/federation-keys.ts";
import {
  createFederationOutbound,
  type FederationOutbound,
} from "./adapters/out/federation/outbound.ts";
import { createFediverseProfileRepository } from "./adapters/out/sqlite/fediverse-profiles.ts";
import { createFollowerRepository } from "./adapters/out/sqlite/followers.ts";
import { createPublicationRepository } from "./adapters/out/sqlite/publications.ts";
import { createFedifyKvStore } from "./adapters/out/sqlite/fedify-kv.ts";
import { existsSync, mkdirSync } from "node:fs";
import { createGpxRouteParser } from "./adapters/out/gpx/route-parser.ts";
import type { AddressInfo } from "node:net";
import { isAbsolute, join } from "node:path";
import { serve } from "@hono/node-server";
import {
  applyRetentionMax,
  runHousekeeping,
  runRetentionSweep,
} from "./application/maintenance.ts";
import { runDueJobs } from "./application/jobs.ts";
import type { PlanDeps } from "./application/plans.ts";
import { runReminders } from "./application/reminders.ts";
import type { Geocoder, PreviewRenderer, WeatherProvider } from "./application/ports.ts";
import { type AccountWiring, createApp } from "./adapters/in/http/app.tsx";
import { createTokenAdminAuth } from "./adapters/out/admin/token-admin-auth.ts";
import { createRateLimits } from "./adapters/in/http/rate-limit.ts";
import {
  SERVICE_CACHE_MS,
  WEATHER_CACHE_MS,
  WEATHER_FAILURE_CACHE_MS,
} from "./adapters/out/cache-lifetime.ts";
import { startScheduler } from "./adapters/in/scheduler.ts";
import { createLogger, type Logger } from "./adapters/logging.ts";
import { type InstanceKeys, openInstanceKeys } from "./adapters/out/crypto/instance-keys.ts";
import { KeyError } from "./adapters/out/crypto/keyring.ts";
import {
  createCachedGeocoder,
  createNominatimGeocoder,
  createThrottle,
} from "./adapters/out/geocoder/nominatim.ts";
import { createOutboundHttp } from "./adapters/out/http/outbound-http.ts";
import type { OutboundHttp } from "./application/ports.ts";
import { createPreviewRenderer } from "./adapters/out/preview/renderer.ts";
import { createCachedWeather, createOpenMeteoWeather } from "./adapters/out/weather/open-meteo.ts";
import { createMapTiles } from "./adapters/out/preview/tiles.ts";
import { createIdGenerator } from "./adapters/out/ids.ts";
import { backupDatabase, createBackupStore } from "./adapters/out/sqlite/backups.ts";
import { createJobQueue } from "./adapters/out/sqlite/jobs.ts";
import { createCalendarFeedRepository } from "./adapters/out/sqlite/calendar-feeds.ts";
import { createChannelRepository } from "./adapters/out/sqlite/channels.ts";
import { loadOrCreateVapidKeys } from "./adapters/out/crypto/vapid-keys.ts";
import { createSentReminderRepository } from "./adapters/out/sqlite/reminders.ts";
import { createWebPushNotifier } from "./adapters/out/push/notifier.ts";
import { createSmtpMailer } from "./adapters/out/email/smtp-mailer.ts";
import { createEmail, type EmailDelivery } from "./adapters/out/email/notifier.ts";
import { createNtfyClient } from "./adapters/out/ntfy/client.ts";
import { createNtfy, type NtfyDelivery } from "./adapters/out/ntfy/notifier.ts";
import { createTelegramClient, type TelegramClient } from "./adapters/out/telegram/client.ts";
import { createTelegram, type TelegramDelivery } from "./adapters/out/telegram/notifier.ts";
import { startTelegramPoller, TELEGRAM_WAIT_SECONDS } from "./adapters/in/telegram-poller.ts";
import { readMeta, writeMeta } from "./adapters/out/sqlite/meta.ts";
import { startTelegramChat } from "./application/telegram.ts";
import { createJobHandlers } from "./job-handlers.ts";
import { isPushServiceHost } from "./domain/push.ts";
import { type Database, openDatabase } from "./adapters/out/sqlite/database.ts";
import { createDeviceRepository } from "./adapters/out/sqlite/devices.ts";
import { createPlanRepository } from "./adapters/out/sqlite/plans.ts";
import { createRecapRepository } from "./adapters/out/sqlite/recap.ts";
import { createTemplateRepository } from "./adapters/out/sqlite/templates.ts";
import { createFormNonceRepository } from "./adapters/out/sqlite/form-nonces.ts";
import { createRatingRepository } from "./adapters/out/sqlite/ratings.ts";
import {
  createInviteRepository,
  createPermissionRepository,
} from "./adapters/out/sqlite/invites.ts";
import { createReportRepository } from "./adapters/out/sqlite/reports.ts";
import {
  createIdentityRepository,
  createPendingLoginRepository,
} from "./adapters/out/sqlite/identities.ts";
import { createOidcProvider } from "./adapters/out/identity/oidc.ts";
import { createFediverseProvider } from "./adapters/out/identity/fediverse.ts";
import { fediverseCallbackUri } from "./adapters/in/http/routes/account.tsx";
import { createTrustedFetch } from "./adapters/out/http/trusted-fetch.ts";
import { createResponseRepository } from "./adapters/out/sqlite/responses.ts";
import { systemClock } from "./adapters/out/system-clock.ts";
import { createTokenService } from "./adapters/out/tokens.ts";
import { type Config, type ConfigSource, loadConfig } from "./config.ts";

/** Port inside the container; publish it or put a reverse proxy in front. */
export const DEFAULT_PORT = 3000;

const MINUTE_MS = 60 * 1000;
/** How often due background jobs run; short, so notifications arrive promptly. */
const JOB_INTERVAL_MS = 10 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Outbound requests to tile and geocoding providers, identified as their policies require. */
function outboundHttp(
  config: Config,
  contactEmail: string | undefined,
  allowHost?: (hostname: string) => boolean,
) {
  return createOutboundHttp({
    userAgent:
      contactEmail === undefined
        ? `RendezRoute (+${config.baseUrl.origin})`
        : `RendezRoute (+${config.baseUrl.origin}; ${contactEmail})`,
    ...(allowHost === undefined ? {} : { allowHost }),
    // Decision C7: development may point providers at local fake servers.
    ...(config.allowInsecureDev ? { allowHttp: true, isBlocked: () => false } : {}),
  });
}

/** Place search (spec 3.9): at most one request per second, results cached for at most 7 days. */
function createGeocoder(config: Config): Geocoder | undefined {
  if (!config.geocoder.enabled || config.contactEmail === undefined) return undefined;
  const geocoder = createNominatimGeocoder({
    http: outboundHttp(config, config.contactEmail),
    baseUrl: config.geocoder.url,
    throttle: createThrottle({ minIntervalMs: 1000, maxWaitMs: 5000 }),
  });
  return createCachedGeocoder(geocoder, {
    clock: systemClock,
    ttlMs: SERVICE_CACHE_MS,
    maxEntries: 1000,
  });
}

/** Forecasts on plan pages (spec 3.9), cached in memory for an hour per point and hour. */
function createWeather(config: Config, logger: Logger): WeatherProvider | undefined {
  if (!config.weather.enabled) return undefined;
  const weather = createOpenMeteoWeather({
    http: outboundHttp(config, config.contactEmail),
    baseUrl: config.weather.url,
  });
  return createCachedWeather(weather, {
    clock: systemClock,
    ttlMs: WEATHER_CACHE_MS,
    failureTtlMs: WEATHER_FAILURE_CACHE_MS,
    maxEntries: 1000,
    // Error class only: messages may contain URLs (spec 3.8).
    onError: (error) =>
      logger.warn("weather_failed", { error: error instanceof Error ? error.name : "unknown" }),
  });
}

/** Link preview cards (spec 3.3), with a rough-area map when tiles may be fetched server-side. */
function createRenderer(config: Config): PreviewRenderer {
  const tiles =
    config.maps.serverSideTiles && config.contactEmail !== undefined
      ? createMapTiles({
          http: outboundHttp(config, config.contactEmail),
          tileUrl: config.maps.tileUrl,
          clock: systemClock,
          ttlMs: SERVICE_CACHE_MS,
          maxEntries: 500,
        })
      : undefined;
  return createPreviewRenderer({
    instanceName: config.instanceName,
    attribution: config.maps.attribution,
    tiles,
  });
}

export interface RunningServer {
  url: URL;
  close(): Promise<void>;
}

export type StartResult =
  | { ok: true; server: RunningServer; warnings: string[] }
  | { ok: false; errors: string[] };

interface Instance {
  /** Notifications by email and ntfy; each undefined while its service is not configured. */
  deliveries: {
    email: EmailDelivery | undefined;
    ntfy: NtfyDelivery | undefined;
    telegram: TelegramDelivery | undefined;
  };
  /** The bot and where its name comes from once the poller runs; undefined without a bot. */
  telegram: { client: TelegramClient; name: { current: () => string | undefined } } | undefined;
  config: Config;
  database: Database;
  keys: InstanceKeys;
  planDeps: PlanDeps;
  /** The instance actor's keys and the remote requests of federation; undefined while it is off. */
  federation:
    | { instanceKeys: SigningKeyPair[]; http: OutboundHttp; outbound: FederationOutbound }
    | undefined;
  warnings: string[];
}

/** Configuration, database and keys, shared by the server and CLI commands. */
const databasePath = (config: Config) => join(config.dataDir, "rendezroute.db");

/** Pre-migration backups live next to the database (spec 11). */
const backupDir = (config: Config) => join(config.dataDir, "backups");

async function openInstance(
  env: ConfigSource,
): Promise<{ ok: true; instance: Instance } | { ok: false; errors: string[] }> {
  const loaded = loadConfig(env);
  if (!loaded.ok) return loaded;
  const { config } = loaded;
  const warnings = [...loaded.warnings];

  mkdirSync(config.dataDir, { recursive: true });
  const database = await openDatabase(databasePath(config), {
    backups: { dir: backupDir(config), now: () => systemClock.now() },
  });

  let keys: InstanceKeys;
  try {
    keys = await openInstanceKeys(config, database);
  } catch (error) {
    await database.close();
    if (error instanceof KeyError) return { ok: false, errors: [error.message] };
    throw error;
  }
  if (keys.warning !== undefined) warnings.push(keys.warning);

  const ids = createIdGenerator();
  // Email (decision D31): the mail server is trusted configuration, so no SSRF checks here.
  const email =
    config.smtp === undefined
      ? undefined
      : createEmail({
          mailer: createSmtpMailer({ smtp: config.smtp, instanceName: config.instanceName }),
          links: keys.channelLinks,
          baseUrl: config.baseUrl,
          instanceName: config.instanceName,
          contactEmail: config.contactEmail,
          timeZone: config.defaultTimezone,
        });
  // Telegram (decision D34): the Bot API is trusted configuration; a long poll may take its wait
  // and some more before the request gives up.
  const telegramClient =
    config.telegram === undefined
      ? undefined
      : createTelegramClient({
          apiUrl: config.telegram.apiUrl,
          token: config.telegram.token,
          fetch: createTrustedFetch({
            userAgent: `RendezRoute (+${config.baseUrl.origin})`,
            allowHttp: config.allowInsecureDev,
            timeoutMs: (TELEGRAM_WAIT_SECONDS + 15) * 1000,
          }),
        });
  const botName = { current: (): string | undefined => undefined };
  const telegram =
    telegramClient === undefined
      ? undefined
      : createTelegram({
          client: telegramClient,
          links: keys.channelLinks,
          baseUrl: config.baseUrl,
          instanceName: config.instanceName,
          timeZone: config.defaultTimezone,
        });
  // ntfy (decision D33): the instance's server is trusted configuration and may be on the local
  // network, like the OIDC issuer.
  const ntfy =
    config.ntfy === undefined
      ? undefined
      : {
          server: config.ntfy.url,
          ...createNtfy({
            server: config.ntfy.url,
            client: createNtfyClient({
              server: config.ntfy.url,
              token: config.ntfy.token,
              fetch: createTrustedFetch({
                userAgent: `RendezRoute (+${config.baseUrl.origin})`,
                allowHttp: config.allowInsecureDev,
              }),
            }),
            links: keys.channelLinks,
            baseUrl: config.baseUrl,
            instanceName: config.instanceName,
            timeZone: config.defaultTimezone,
          }),
        };
  // The instance in the fediverse (decision D36): its actor's keys in the key directory; fediverse
  // servers are named by others, so their requests get full SSRF protection (spec 3.11).
  const profiles = createFediverseProfileRepository(database, keys.cipher, keys.identityLookup);
  const jobs = createJobQueue(database, keys.cipher, ids);
  const federation = config.federationEnabled
    ? await (async () => {
        const instanceKeys = await loadOrCreateInstanceKeys(keys.directory);
        const http = outboundHttp(config, config.contactEmail);
        const outbound = createFederationOutbound({
          jobs,
          clock: systemClock,
          ids,
          baseUrl: config.baseUrl,
          instanceKeys,
          profiles,
          http,
        });
        return { instanceKeys, http, outbound };
      })()
    : undefined;
  const planDeps: PlanDeps = {
    plans: createPlanRepository(database, keys.cipher),
    devices: createDeviceRepository(database),
    responses: createResponseRepository(database, keys.cipher),
    routeParser: createGpxRouteParser(),
    tokens: createTokenService(),
    ids,
    clock: systemClock,
    limits: { horizonDays: config.maxPlanHorizonDays, maxRetentionDays: config.maxRetentionDays },
    calendarFeeds: createCalendarFeedRepository(database),
    recap: createRecapRepository(database, keys.cipher),
    templates: createTemplateRepository(database, keys.cipher),
    formNonces: createFormNonceRepository(database),
    ratings: createRatingRepository(database, keys.cipher),
    reports: createReportRepository(database, keys.cipher),
    postingMode: config.postingMode,
    publicRequiresLogin: config.publicRequiresLogin,
    publicPlansOffered: config.nearbyEnabled,
    // Always there, so accounts can be deleted after federation was turned off (decision D37).
    posterActors: {
      profiles,
      actorKeys: actorKeyFactory,
      followers: createFollowerRepository(database, keys.cipher, keys.identityLookup, ids),
      publications: createPublicationRepository(database),
      // Deliveries go through the job queue (decision D38).
      publisher: federation?.outbound.publisher,
      enabled: config.federationEnabled,
    },
    invites: createInviteRepository(database),
    permissions: createPermissionRepository(database),
    notify: {
      channels: createChannelRepository(database, keys.cipher, ids, () => systemClock.now()),
      jobs,
      reminders: createSentReminderRepository(database),
      links: keys.channelLinks,
      email: {
        outbox: email?.outbox,
        reportAlerts: email !== undefined && config.contactEmail !== undefined,
      },
      ntfy: ntfy === undefined ? undefined : { outbox: ntfy.outbox, server: ntfy.server },
      telegram:
        telegram === undefined
          ? undefined
          : { outbox: telegram.outbox, botName: () => botName.current() },
    },
  };
  return {
    ok: true,
    instance: {
      config,
      database,
      keys,
      planDeps,
      federation,
      warnings,
      deliveries: { email: email?.delivery, ntfy: ntfy?.delivery, telegram: telegram?.delivery },
      telegram:
        telegramClient === undefined ? undefined : { client: telegramClient, name: botName },
    },
  };
}

export async function startServer(
  env: ConfigSource,
  { port = DEFAULT_PORT, logger = createLogger() }: { port?: number; logger?: Logger } = {},
): Promise<StartResult> {
  const opened = await openInstance(env);
  if (!opened.ok) return opened;
  const { config, database, keys, planDeps, warnings } = opened.instance;

  const rateLimits = createRateLimits(() => planDeps.clock.now().getTime());

  // Accounts (spec 7 Identity): the OIDC issuer is trusted configuration and may be on the local
  // network (decision D23), so it gets the trusted fetch, not OutboundHttp.
  const accounts: AccountWiring = {
    identities: createIdentityRepository(database, keys.cipher),
    pendingLogins: createPendingLoginRepository(database, keys.cipher),
    identityLookup: keys.identityLookup,
    fediverse: {
      servers: config.fediverseLogin?.servers,
      allowInsecure: config.allowInsecureDev,
    },
    identityProviders: {
      // Fediverse servers are typed by people: full SSRF protection (decision D24).
      ...(config.fediverseLogin === undefined
        ? {}
        : {
            fediverse: createFediverseProvider({
              http: outboundHttp(config, config.contactEmail),
              callbackUri: fediverseCallbackUri(config.baseUrl, keys.identityLookup),
              clientName: config.instanceName,
              website: config.baseUrl,
            }),
          }),
      ...(config.oidc === undefined
        ? {}
        : {
            oidc: createOidcProvider({
              issuer: config.oidc.issuer,
              clientId: config.oidc.clientId,
              clientSecret: config.oidc.clientSecret,
              redirectUri: new URL("/login/oidc/callback", config.baseUrl),
              fetch: createTrustedFetch({
                userAgent: `RendezRoute (+${config.baseUrl.origin})`,
                allowHttp: config.allowInsecureDev,
              }),
              allowHttp: config.allowInsecureDev,
            }),
          }),
    },
  };

  // Web Push (spec 6 feature 3): the instance's VAPID keys live next to the encryption key.
  const notify = planDeps.notify;
  if (notify === undefined) throw new Error("notification dependencies missing");
  const vapid = loadOrCreateVapidKeys(keys.directory);
  const notifier = createWebPushNotifier({
    channels: notify.channels,
    // Only the browser vendors' push services; endpoints come from browsers (decision I36).
    http: outboundHttp(config, config.contactEmail, isPushServiceHost),
    vapid,
    subject:
      config.contactEmail === undefined ? config.baseUrl.href : `mailto:${config.contactEmail}`,
    baseUrl: config.baseUrl,
    now: () => planDeps.clock.now(),
  });
  const jobHandlers = createJobHandlers({
    planDeps,
    push: notifier,
    ...opened.instance.deliveries,
    identities: accounts.identities,
    federation: opened.instance.federation?.outbound,
  });

  const sweepLimits = () => {
    for (const limiter of Object.values(rateLimits)) limiter.sweep();
    return Promise.resolve({});
  };

  // The instance in the fediverse (0.9 steps 9a, 10a): its state in the database file, its actor's
  // keys in the key directory (decision D36).
  const federationKv = createFedifyKvStore(database, () => planDeps.clock.now());
  const instanceFederation = opened.instance.federation;
  const federation =
    instanceFederation === undefined
      ? undefined
      : createInstanceFederation({
          settings: {
            baseUrl: config.baseUrl,
            instanceName: config.instanceName,
          },
          kv: federationKv,
          http: instanceFederation.http,
          instanceKeys: instanceFederation.instanceKeys,
          planDeps,
          identities: accounts.identities,
        });

  // The first sweep finishes before the server listens, so plans past their deletion
  // date are never served after downtime (spec 3.10: sweep at startup).
  const scheduler = await startScheduler(
    [
      { name: "retention_sweep", intervalMs: MINUTE_MS, run: () => runRetentionSweep(planDeps) },
      {
        name: "housekeeping",
        intervalMs: DAY_MS,
        run: () =>
          runHousekeeping({
            ...planDeps,
            backups: createBackupStore(backupDir(config)),
            pendingLogins: accounts.pendingLogins,
            identities: accounts.identities,
          }),
      },
      // Cached remote documents and other expired federation state.
      {
        name: "federation_sweep",
        intervalMs: DAY_MS,
        run: async () => ({ deleted: await federationKv.deleteExpired() }),
      },
      // Background jobs (spec 6 feature 12): notifications, with retries.
      {
        name: "jobs",
        intervalMs: JOB_INTERVAL_MS,
        run: () => runDueJobs({ jobs: notify.jobs, clock: planDeps.clock }, jobHandlers),
      },
      // Day-before and deletion reminders (spec 6 feature 3, 3.10), queued as jobs above.
      { name: "reminders", intervalMs: MINUTE_MS, run: () => runReminders(planDeps) },
      // Forgets client addresses whose limits have refilled, also when no requests come in.
      { name: "rate_limit_sweep", intervalMs: MINUTE_MS, run: sweepLimits },
    ],
    { logger },
  );

  // The bot's messages (decision D34): "/start <code>" links a chat; the name feeds the deep link.
  const bot = opened.instance.telegram;
  const poller =
    bot === undefined
      ? undefined
      : startTelegramPoller({
          client: bot.client,
          offset: {
            read: async () => Number((await readMeta(database, "telegram_offset")) ?? "0"),
            write: (value) => writeMeta(database, "telegram_offset", String(value)),
          },
          onStart: (start) => startTelegramChat(planDeps, start),
          logger,
        });
  if (bot !== undefined && poller !== undefined) bot.name.current = () => poller.botName();

  const app = createApp({
    config,
    csrfKey: keys.csrfKey,
    logger,
    planDeps,
    geocoder: createGeocoder(config),
    previewRenderer: createRenderer(config),
    weather: createWeather(config, logger),
    rateLimits,
    vapidPublicKey: vapid.publicKey,
    adminAuth:
      config.adminToken === undefined ? undefined : createTokenAdminAuth(config.adminToken),
    accounts,
    federation,
  });
  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const instance = serve({ fetch: app.fetch, port }, () => resolve(instance));
  });
  const address = server.address() as AddressInfo;

  return {
    ok: true,
    warnings,
    server: {
      url: new URL(`http://127.0.0.1:${address.port}`),
      close: async () => {
        await poller?.stop();
        await scheduler.stop();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        await database.close();
      },
    },
  };
}

/** CLI `apply-retention-max` (spec 3.10): applies the configured maximum to existing plans. */
export async function runApplyRetentionMax(
  env: ConfigSource,
): Promise<
  | { ok: true; shortened: number; deleted: number; warnings: string[] }
  | { ok: false; errors: string[] }
> {
  const opened = await openInstance(env);
  if (!opened.ok) return opened;
  const { config, database, planDeps, warnings } = opened.instance;
  try {
    const result = await applyRetentionMax(planDeps, { maxRetentionDays: config.maxRetentionDays });
    return { ok: true, ...result, warnings };
  } finally {
    await database.close();
  }
}

/**
 * CLI `backup <directory>` (spec 11): copies the live database with SQLite's online backup API,
 * so it is safe while the server runs. The encryption key is backed up separately.
 */
export async function runBackup(
  env: ConfigSource,
  directory: string,
): Promise<{ ok: true; path: string } | { ok: false; errors: string[] }> {
  const loaded = loadConfig(env);
  if (!loaded.ok) return loaded;
  if (!isAbsolute(directory)) {
    return {
      ok: false,
      errors: [`The backup directory must be an absolute path, got "${directory}".`],
    };
  }
  const source = databasePath(loaded.config);
  if (!existsSync(source)) return { ok: false, errors: [`No database at ${source}.`] };
  return { ok: true, path: await backupDatabase(source, directory, systemClock.now()) };
}
