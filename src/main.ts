// Composition root (spec 2a): reads configuration and wires the enabled adapters.
import { mkdirSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./adapters/in/http/app.tsx";
import { createLogger, type Logger } from "./adapters/logging.ts";
import { openInstanceKeys } from "./adapters/out/crypto/instance-keys.ts";
import { KeyError } from "./adapters/out/crypto/keyring.ts";
import { openDatabase } from "./adapters/out/sqlite/database.ts";
import { type ConfigSource, loadConfig } from "./config.ts";

/** Port inside the container; publish it or put a reverse proxy in front. */
export const DEFAULT_PORT = 3000;

export interface RunningServer {
  url: URL;
  close(): Promise<void>;
}

export type StartResult =
  | { ok: true; server: RunningServer; warnings: string[] }
  | { ok: false; errors: string[] };

interface StartOptions {
  port?: number;
  logger?: Logger;
}

export async function startServer(
  env: ConfigSource,
  { port = DEFAULT_PORT, logger = createLogger() }: StartOptions = {},
): Promise<StartResult> {
  const loaded = loadConfig(env);
  if (!loaded.ok) return loaded;
  const { config } = loaded;
  const warnings = [...loaded.warnings];

  mkdirSync(config.dataDir, { recursive: true });
  const database = await openDatabase(join(config.dataDir, "rendezroute.db"));

  let csrfKey: Buffer;
  try {
    const keys = await openInstanceKeys(config, database);
    csrfKey = keys.csrfKey;
    if (keys.warning !== undefined) warnings.push(keys.warning);
  } catch (error) {
    await database.close();
    if (error instanceof KeyError) return { ok: false, errors: [error.message] };
    throw error;
  }

  const app = createApp({ config, csrfKey, logger });
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
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        await database.close();
      },
    },
  };
}
