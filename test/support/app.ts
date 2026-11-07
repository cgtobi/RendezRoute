import { randomBytes } from "node:crypto";
import { createApp } from "../../src/adapters/in/http/app.tsx";
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
import { FakeClock } from "../fakes/clock.ts";
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
}: { databasePath?: string; env?: Record<string, string> } = {}) {
  const config = testConfig(env);
  const database: Database = await openDatabase(databasePath);
  const cipher = createFieldCipher(createKeyring(1, [[1, randomBytes(32)]]));
  const clock = new FakeClock(fixtureNow);
  const logs: string[] = [];
  const app = createApp({
    config,
    csrfKey: randomBytes(32),
    logger: createLogger({ write: (line) => logs.push(line) }),
    planDeps: {
      plans: createPlanRepository(database, cipher),
      devices: createDeviceRepository(database),
      responses: createResponseRepository(database, cipher),
      tokens: createTokenService(),
      ids: createIdGenerator(),
      clock,
      limits: { horizonDays: config.maxPlanHorizonDays, maxRetentionDays: config.maxRetentionDays },
    },
  });
  return { app, database, clock, logs, config };
}
