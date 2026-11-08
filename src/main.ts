// Composition root (spec 2a): reads configuration and wires the enabled adapters.
import { mkdirSync } from "node:fs";
import { createGpxRouteParser } from "./adapters/out/gpx/route-parser.ts";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import {
  applyRetentionMax,
  runHousekeeping,
  runRetentionSweep,
} from "./application/maintenance.ts";
import type { PlanDeps } from "./application/plans.ts";
import type { Geocoder, PreviewRenderer } from "./application/ports.ts";
import { createApp } from "./adapters/in/http/app.tsx";
import { createRateLimits } from "./adapters/in/http/rate-limit.ts";
import { SERVICE_CACHE_MS } from "./adapters/out/cache-lifetime.ts";
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
import { createPreviewRenderer } from "./adapters/out/preview/renderer.ts";
import { createMapTiles } from "./adapters/out/preview/tiles.ts";
import { createIdGenerator } from "./adapters/out/ids.ts";
import { createBackupStore } from "./adapters/out/sqlite/backups.ts";
import { type Database, openDatabase } from "./adapters/out/sqlite/database.ts";
import { createDeviceRepository } from "./adapters/out/sqlite/devices.ts";
import { createPlanRepository } from "./adapters/out/sqlite/plans.ts";
import { createResponseRepository } from "./adapters/out/sqlite/responses.ts";
import { systemClock } from "./adapters/out/system-clock.ts";
import { createTokenService } from "./adapters/out/tokens.ts";
import { type Config, type ConfigSource, loadConfig } from "./config.ts";

/** Port inside the container; publish it or put a reverse proxy in front. */
export const DEFAULT_PORT = 3000;

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Outbound requests to tile and geocoding providers, identified as their policies require. */
function outboundHttp(config: Config, contactEmail: string) {
  return createOutboundHttp({
    userAgent: `RendezRoute (+${config.baseUrl.origin}; ${contactEmail})`,
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
  config: Config;
  database: Database;
  keys: InstanceKeys;
  planDeps: PlanDeps;
  warnings: string[];
}

/** Configuration, database and keys, shared by the server and CLI commands. */
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
  const database = await openDatabase(join(config.dataDir, "rendezroute.db"), {
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

  const planDeps: PlanDeps = {
    plans: createPlanRepository(database, keys.cipher),
    devices: createDeviceRepository(database),
    responses: createResponseRepository(database, keys.cipher),
    routeParser: createGpxRouteParser(),
    tokens: createTokenService(),
    ids: createIdGenerator(),
    clock: systemClock,
    limits: { horizonDays: config.maxPlanHorizonDays, maxRetentionDays: config.maxRetentionDays },
  };
  return { ok: true, instance: { config, database, keys, planDeps, warnings } };
}

export async function startServer(
  env: ConfigSource,
  { port = DEFAULT_PORT, logger = createLogger() }: { port?: number; logger?: Logger } = {},
): Promise<StartResult> {
  const opened = await openInstance(env);
  if (!opened.ok) return opened;
  const { config, database, keys, planDeps, warnings } = opened.instance;

  const rateLimits = createRateLimits(() => planDeps.clock.now().getTime());
  const sweepLimits = () => {
    for (const limiter of Object.values(rateLimits)) limiter.sweep();
    return Promise.resolve({});
  };

  // The first sweep finishes before the server listens, so plans past their deletion
  // date are never served after downtime (spec 3.10: sweep at startup).
  const scheduler = await startScheduler(
    [
      { name: "retention_sweep", intervalMs: MINUTE_MS, run: () => runRetentionSweep(planDeps) },
      {
        name: "housekeeping",
        intervalMs: DAY_MS,
        run: () => runHousekeeping({ ...planDeps, backups: createBackupStore(backupDir(config)) }),
      },
      // Forgets client addresses whose limits have refilled, also when no requests come in.
      { name: "rate_limit_sweep", intervalMs: MINUTE_MS, run: sweepLimits },
    ],
    { logger },
  );

  const app = createApp({
    config,
    csrfKey: keys.csrfKey,
    logger,
    planDeps,
    geocoder: createGeocoder(config),
    previewRenderer: createRenderer(config),
    rateLimits,
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
