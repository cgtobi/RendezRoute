import { randomBytes } from "node:crypto";
import { createGpxRouteParser } from "../../src/adapters/out/gpx/route-parser.ts";
import { createApp } from "../../src/adapters/in/http/app.tsx";
import { createRateLimits } from "../../src/adapters/in/http/rate-limit.ts";
import { createLogger } from "../../src/adapters/logging.ts";
import { createFieldCipher } from "../../src/adapters/out/crypto/field-cipher.ts";
import { createKeyring } from "../../src/adapters/out/crypto/keyring.ts";
import { createIdGenerator } from "../../src/adapters/out/ids.ts";
import { type Database, openDatabase } from "../../src/adapters/out/sqlite/database.ts";
import { createDeviceRepository } from "../../src/adapters/out/sqlite/devices.ts";
import { createPlanRepository } from "../../src/adapters/out/sqlite/plans.ts";
import { createResponseRepository } from "../../src/adapters/out/sqlite/responses.ts";
import { createTokenService } from "../../src/adapters/out/tokens.ts";
import { type Config, loadConfig } from "../../src/config.ts";
import type { PlanDeps } from "../../src/application/plans.ts";
import type { PreviewRenderer } from "../../src/application/ports.ts";
import { FakeClock } from "../fakes/clock.ts";
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
}: {
  databasePath?: string;
  env?: Record<string, string>;
  geocoder?: FakeGeocoder;
  /** A real renderer instead of the fake, for tests of the actual card image. */
  renderer?: PreviewRenderer;
} = {}) {
  const config = testConfig(env);
  const database: Database = await openDatabase(databasePath);
  const cipher = createFieldCipher(createKeyring(1, [[1, randomBytes(32)]]));
  const clock = new FakeClock(fixtureNow);
  const logs: string[] = [];
  const previewRenderer = new FakePreviewRenderer();
  const planDeps: PlanDeps = {
    plans: createPlanRepository(database, cipher),
    devices: createDeviceRepository(database),
    responses: createResponseRepository(database, cipher),
    routeParser: createGpxRouteParser(),
    tokens: createTokenService(),
    ids: createIdGenerator(),
    clock,
    limits: { horizonDays: config.maxPlanHorizonDays, maxRetentionDays: config.maxRetentionDays },
  };
  const app = createApp({
    config,
    geocoder: config.geocoder.enabled ? geocoder : undefined,
    previewRenderer: renderer ?? previewRenderer,
    rateLimits: createRateLimits(() => clock.now().getTime()),
    csrfKey: randomBytes(32),
    logger: createLogger({ write: (line) => logs.push(line) }),
    planDeps,
  });
  return { app, database, clock, logs, config, geocoder, previewRenderer, planDeps };
}
