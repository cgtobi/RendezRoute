import { randomBytes } from "node:crypto";
import { createGpxRouteParser } from "../../src/adapters/out/gpx/route-parser.ts";
import { createApp } from "../../src/adapters/in/http/app.tsx";
import { createTokenAdminAuth } from "../../src/adapters/out/admin/token-admin-auth.ts";
import { createRateLimits } from "../../src/adapters/in/http/rate-limit.ts";
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
import { FakeClock } from "../fakes/clock.ts";
import type { FakeOidcServer } from "../fakes/oidc-server.ts";
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
  const planDeps: PlanDeps = {
    plans: createPlanRepository(database, cipher),
    devices: createDeviceRepository(database),
    responses: createResponseRepository(database, cipher),
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
    invites: createInviteRepository(database),
    permissions: createPermissionRepository(database),
    notify: { channels, jobs, reminders: createSentReminderRepository(database) },
  };
  const pendingLogins = createPendingLoginRepository(database, cipher);
  const app = createApp({
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
      identities: createIdentityRepository(database, cipher),
      pendingLogins,
      identityLookup: createLookupHasher(randomBytes(32)),
      identityProviders:
        config.oidc === undefined || oidc === undefined
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
            },
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
  };
}
