import { actorKeyFactory } from "../../src/adapters/out/crypto/federation-keys.ts";
import { createFederationOutbound } from "../../src/adapters/out/federation/outbound.ts";
import { createFollowerRepository } from "../../src/adapters/out/sqlite/followers.ts";
import { createPublicationRepository } from "../../src/adapters/out/sqlite/publications.ts";
import { createFediverseProfileRepository } from "../../src/adapters/out/sqlite/fediverse-profiles.ts";
import { FakeOutboundHttp } from "../fakes/outbound-http.ts";
import { generateCryptoKeyPair } from "@fedify/fedify";
import { createInstanceFederation } from "../../src/adapters/in/activitypub/federation.ts";
import { createFedifyKvStore } from "../../src/adapters/out/sqlite/fedify-kv.ts";
import { randomBytes } from "node:crypto";
import { createGpxRouteParser } from "../../src/adapters/out/gpx/route-parser.ts";
import { createApp } from "../../src/adapters/in/http/app.tsx";
import { createTokenAdminAuth } from "../../src/adapters/out/admin/token-admin-auth.ts";
import { createJoinLimits, createRateLimits } from "../../src/adapters/in/http/rate-limit.ts";
import { generateVapidKeys } from "../../src/adapters/out/crypto/vapid-keys.ts";
import { createCalendarFeedRepository } from "../../src/adapters/out/sqlite/calendar-feeds.ts";
import { createChannelRepository } from "../../src/adapters/out/sqlite/channels.ts";
import { createJobQueue } from "../../src/adapters/out/sqlite/jobs.ts";
import { createSentReminderRepository } from "../../src/adapters/out/sqlite/reminders.ts";
import { createLogger } from "../../src/adapters/logging.ts";
import { createFieldCipher } from "../../src/adapters/out/crypto/field-cipher.ts";
import { createKeyring } from "../../src/adapters/out/crypto/keyring.ts";
import { createIdGenerator } from "../../src/adapters/out/ids.ts";
import { type Database, openDatabase } from "../../src/adapters/out/sqlite/database.ts";
import { createDeviceRepository } from "../../src/adapters/out/sqlite/devices.ts";
import { createPlanRepository } from "../../src/adapters/out/sqlite/plans.ts";
import { createRecapRepository } from "../../src/adapters/out/sqlite/recap.ts";
import { createTemplateRepository } from "../../src/adapters/out/sqlite/templates.ts";
import { createFormNonceRepository } from "../../src/adapters/out/sqlite/form-nonces.ts";
import { createRatingRepository } from "../../src/adapters/out/sqlite/ratings.ts";
import {
  createInviteRepository,
  createPermissionRepository,
} from "../../src/adapters/out/sqlite/invites.ts";
import { createReportRepository } from "../../src/adapters/out/sqlite/reports.ts";
import { createResponseRepository } from "../../src/adapters/out/sqlite/responses.ts";
import { createTokenService } from "../../src/adapters/out/tokens.ts";
import { type Config, loadConfig } from "../../src/config.ts";
import type { PlanDeps } from "../../src/application/plans.ts";
import type { PreviewRenderer, WeatherProvider } from "../../src/application/ports.ts";
import { createLookupHasher } from "../../src/adapters/out/crypto/lookup-hasher.ts";
import { createOidcProvider } from "../../src/adapters/out/identity/oidc.ts";
import {
  createIdentityRepository,
  createPendingLoginRepository,
} from "../../src/adapters/out/sqlite/identities.ts";
import { createChannelLinks } from "../../src/adapters/out/crypto/channel-links.ts";
import { createEmail } from "../../src/adapters/out/email/notifier.ts";
import { createNtfy } from "../../src/adapters/out/ntfy/notifier.ts";
import { FakeNtfyClient } from "../fakes/ntfy.ts";
import { FakeTelegramClient } from "../fakes/telegram.ts";
import { createTelegram } from "../../src/adapters/out/telegram/notifier.ts";
import { startTelegramChat } from "../../src/application/telegram.ts";
import { createJobHandlers } from "../../src/job-handlers.ts";
import { runDueJobs } from "../../src/application/jobs.ts";
import { FakeClock } from "../fakes/clock.ts";
import { FakeMailer } from "../fakes/mailer.ts";
import { FakeNotifier } from "../fakes/notifier.ts";
import type { FakeOidcServer } from "../fakes/oidc-server.ts";
import { type FakeMastodonServer, fediverse } from "../fakes/mastodon-server.ts";
import { createFediverseProvider } from "../../src/adapters/out/identity/fediverse.ts";
import { fediverseCallbackUri } from "../../src/adapters/in/http/routes/account.tsx";
import { FakeGeocoder } from "../fakes/geocoder.ts";
import { FakePreviewRenderer } from "../fakes/preview-renderer.ts";
import { fixtureNow } from "../fixtures/plans.ts";

export function testConfig(env: Record<string, string> = {}): Config {
  const result = loadConfig({
    BASE_URL: "https://runs.example.org",
    CONTACT_EMAIL: "owner@example.org",
    ...env,
  });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.config;
}

/** The instance actor's keys: generating RSA keys is slow, so all test apps share one pair. */
let instanceKeys: Promise<CryptoKeyPair[]> | undefined;

/** The real app on a fresh SQLite database (":memory:" unless a path is given) with a fake clock. */
export async function createTestApp({
  databasePath = ":memory:",
  env = {},
  geocoder = new FakeGeocoder({
    Flaucher: [{ label: "Flaucher, Isar, Munich", lat: 48.1107, lng: 11.5582 }],
  }),
  renderer,
  weather,
  oidc,
  mastodon = [],
}: {
  databasePath?: string;
  env?: Record<string, string>;
  geocoder?: FakeGeocoder;
  /** A real renderer instead of the fake, for tests of the actual card image. */
  renderer?: PreviewRenderer;
  /** Forecasts for plan pages; none by default, so tests never depend on weather. */
  weather?: WeatherProvider;
  /** A fake OIDC provider the app talks to; pass its env() too. */
  oidc?: FakeOidcServer;
  /** Fake Mastodon servers fediverse logins reach; set FEDIVERSE_LOGIN=true too. */
  mastodon?: FakeMastodonServer[];
} = {}) {
  const config = testConfig(env);
  const database: Database = await openDatabase(databasePath);
  const cipher = createFieldCipher(createKeyring(1, [[1, randomBytes(32)]]));
  const clock = new FakeClock(fixtureNow);
  const logs: string[] = [];
  const previewRenderer = new FakePreviewRenderer();
  const ids = createIdGenerator();
  const channels = createChannelRepository(database, cipher, ids, () => clock.now());
  const jobs = createJobQueue(database, cipher, ids);
  const vapidPublicKey = generateVapidKeys().publicKey;
  // The instance in the fediverse (0.9 steps 9a, 10a), its keys made once per test run; remote
  // requests go to a fake that refuses everything unless a test says otherwise.
  const federationHttp = new FakeOutboundHttp();
  const federationKeys = config.federationEnabled
    ? await (instanceKeys ??= Promise.all([
        generateCryptoKeyPair("RSASSA-PKCS1-v1_5"),
        generateCryptoKeyPair("Ed25519"),
      ]))
    : undefined;
  const profiles = createFediverseProfileRepository(
    database,
    cipher,
    createLookupHasher(randomBytes(32)),
  );
  const federationOutbound =
    federationKeys === undefined
      ? undefined
      : createFederationOutbound({
          jobs,
          clock,
          ids,
          baseUrl: config.baseUrl,
          instanceKeys: federationKeys,
          profiles,
          http: federationHttp,
        });
  const lookupHasher = createLookupHasher(randomBytes(32));
  const channelLinks = createChannelLinks(randomBytes(32));
  const mailer = new FakeMailer();
  const email =
    config.smtp === undefined
      ? undefined
      : createEmail({
          mailer,
          links: channelLinks,
          baseUrl: config.baseUrl,
          instanceName: config.instanceName,
          contactEmail: config.contactEmail,
          timeZone: config.defaultTimezone,
        });
  // Telegram messages go to the fake bot (decision D34); tests press Start with pressStart().
  const telegramClient = new FakeTelegramClient();
  const telegram =
    config.telegram === undefined
      ? undefined
      : createTelegram({
          client: telegramClient,
          links: channelLinks,
          baseUrl: config.baseUrl,
          instanceName: config.instanceName,
          timeZone: config.defaultTimezone,
        });
  // ntfy posts go to the fake client (decision D33).
  const ntfyClient = new FakeNtfyClient();
  const ntfy =
    config.ntfy === undefined
      ? undefined
      : {
          server: config.ntfy.url,
          ...createNtfy({
            server: config.ntfy.url,
            client: ntfyClient,
            links: channelLinks,
            baseUrl: config.baseUrl,
            instanceName: config.instanceName,
            timeZone: config.defaultTimezone,
          }),
        };
  const planDeps: PlanDeps = {
    plans: createPlanRepository(database, cipher),
    devices: createDeviceRepository(database),
    responses: createResponseRepository(database, cipher, lookupHasher),
    routeParser: createGpxRouteParser(),
    tokens: createTokenService(),
    ids,
    clock,
    limits: { horizonDays: config.maxPlanHorizonDays, maxRetentionDays: config.maxRetentionDays },
    calendarFeeds: createCalendarFeedRepository(database),
    recap: createRecapRepository(database, cipher),
    templates: createTemplateRepository(database, cipher),
    formNonces: createFormNonceRepository(database),
    ratings: createRatingRepository(database, cipher),
    reports: createReportRepository(database, cipher),
    postingMode: config.postingMode,
    publicRequiresLogin: config.publicRequiresLogin,
    publicPlansOffered: config.nearbyEnabled,
    posterActors: {
      profiles,
      actorKeys: actorKeyFactory,
      followers: createFollowerRepository(database, cipher, lookupHasher, ids),
      publications: createPublicationRepository(database),
      publisher: federationOutbound?.publisher,
      enabled: config.federationEnabled,
    },
    invites: createInviteRepository(database),
    permissions: createPermissionRepository(database),
    notify: {
      channels,
      jobs,
      reminders: createSentReminderRepository(database),
      links: channelLinks,
      email: {
        outbox: email?.outbox,
        reportAlerts: config.smtp !== undefined && config.contactEmail !== undefined,
      },
      ntfy: ntfy === undefined ? undefined : { outbox: ntfy.outbox, server: ntfy.server },
      telegram:
        telegram === undefined
          ? undefined
          : { outbox: telegram.outbox, botName: () => telegramClient.name },
    },
  };
  const pressStart = (startToken: string, chatId = "424242") =>
    startTelegramChat(planDeps, { startToken, chatId });
  const identities = createIdentityRepository(database, cipher);
  // Jobs run on demand with the real handlers; email goes to the fake mailer (decision D31).
  const pushed = new FakeNotifier();
  const jobHandlers = createJobHandlers({
    planDeps,
    push: pushed,
    email: email?.delivery,
    ntfy: ntfy?.delivery,
    telegram: telegram?.delivery,
    identities,
    federation: federationOutbound,
  });
  const runJobs = () => runDueJobs({ jobs, clock }, jobHandlers);
  const pendingLogins = createPendingLoginRepository(database, cipher);
  const identityLookup = createLookupHasher(randomBytes(32));
  const federationKv = createFedifyKvStore(database, () => clock.now());
  const federation =
    federationKeys === undefined
      ? undefined
      : createInstanceFederation({
          settings: { baseUrl: config.baseUrl, instanceName: config.instanceName },
          kv: federationKv,
          http: federationHttp,
          identities,
          instanceKeys: federationKeys,
          planDeps,
          hasher: lookupHasher,
          joinLimits: createJoinLimits(() => clock.now().getTime()),
        });

  const app = createApp({
    federation,
    config,
    geocoder: config.geocoder.enabled ? geocoder : undefined,
    previewRenderer: renderer ?? previewRenderer,
    weather: config.weather.enabled ? weather : undefined,
    rateLimits: createRateLimits(() => clock.now().getTime()),
    vapidPublicKey,
    adminAuth:
      config.adminToken === undefined ? undefined : createTokenAdminAuth(config.adminToken),
    csrfKey: randomBytes(32),
    accounts: {
      identities,
      pendingLogins,
      identityLookup,
      identityProviders: {
        ...(config.oidc === undefined || oidc === undefined
          ? {}
          : {
              oidc: createOidcProvider({
                issuer: config.oidc.issuer,
                clientId: config.oidc.clientId,
                clientSecret: config.oidc.clientSecret,
                redirectUri: new URL("/login/oidc/callback", config.baseUrl),
                fetch: oidc.fetch,
                allowHttp: false,
              }),
            }),
        ...(config.fediverseLogin === undefined
          ? {}
          : {
              fediverse: createFediverseProvider({
                http: fediverse(...mastodon),
                callbackUri: fediverseCallbackUri(config.baseUrl, identityLookup),
                clientName: config.instanceName,
                website: config.baseUrl,
              }),
            }),
      },
      fediverse: { servers: config.fediverseLogin?.servers, allowInsecure: false },
    },
    logger: createLogger({ write: (line) => logs.push(line) }),
    planDeps,
  });
  return {
    app,
    database,
    clock,
    logs,
    config,
    geocoder,
    previewRenderer,
    planDeps,
    channels,
    jobs,
    vapidPublicKey,
    pendingLogins,
    identities,
    mailer,
    ntfyClient,
    telegramClient,
    pressStart,
    pushed,
    runJobs,
    channelLinks,
    /** Fedify's remote fetches and deliveries (spec 3.11): refuses everything unless told otherwise. */
    federationHttp,
    federationKeys,
  };
}
