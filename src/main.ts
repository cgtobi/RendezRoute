// Composition root (spec 2a): reads configuration and wires the enabled adapters.
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { createApp } from "./adapters/in/http/app.tsx";
import { type Env, loadConfig } from "./config.ts";

/** Port inside the container; publish it or put a reverse proxy in front. */
export const DEFAULT_PORT = 3000;

export interface RunningServer {
  url: URL;
  close(): Promise<void>;
}

export type StartResult =
  | { ok: true; server: RunningServer; warnings: string[] }
  | { ok: false; errors: string[] };

export async function startServer(env: Env, { port = DEFAULT_PORT } = {}): Promise<StartResult> {
  const loaded = loadConfig(env);
  if (!loaded.ok) return loaded;

  const app = createApp({ config: loaded.config });

  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const instance = serve({ fetch: app.fetch, port }, () => resolve(instance));
  });
  const address = server.address() as AddressInfo;

  return {
    ok: true,
    warnings: loaded.warnings,
    server: {
      url: new URL(`http://127.0.0.1:${address.port}`),
      close: () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    },
  };
}
