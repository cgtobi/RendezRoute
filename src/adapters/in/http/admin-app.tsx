// The admin-only app (decision D55): the instance admin pages on their own listener, composed
// from the same stack as the public app (app-common.tsx) but with no Fedify, no inbox and no
// public routes, and with its own CSRF key, cookie and origin rule (admin-listener.ts).
import { Hono } from "hono";
import type { PlanDeps } from "../../../application/plans.ts";
import type { AdminAuth } from "../../../application/ports.ts";
import type { Config } from "../../../config.ts";
import type { Logger } from "../../logging.ts";
import { adminCsrfOptions } from "./admin-listener.ts";
import type { AppEnv } from "./app.tsx";
import { composeCommonStack } from "./app-common.tsx";
import type { RateLimits } from "./rate-limit.ts";
import { registerAdminRoutes } from "./routes/admin.tsx";

export interface AdminAppDeps {
  /** `config.admin` must be set: this app exists only for the admin listener. */
  config: Config;
  /** Derived from the encryption key separately from the public one (deriveKey "csrf-admin"). */
  csrfKey: Buffer;
  logger: Logger;
  planDeps: PlanDeps;
  /** The same limits as the public app: one login rate limit, however it is reached. */
  rateLimits: RateLimits;
  adminAuth: AdminAuth;
}

export function createAdminApp({
  config,
  csrfKey,
  logger,
  planDeps,
  rateLimits,
  adminAuth,
}: AdminAppDeps): Hono<AppEnv> {
  if (config.admin === undefined) throw new Error("createAdminApp needs ADMIN_PORT");
  const app = new Hono<AppEnv>();
  composeCommonStack(app, {
    config,
    logger,
    csrf: { key: csrfKey, ...adminCsrfOptions(config) },
    adminListener: true,
  });
  // Relative, so a path prefix in front of the listener (Home Assistant Ingress) keeps working.
  app.get("/", (c) => c.redirect("admin/", 303));
  registerAdminRoutes(app, { config, adminDeps: { ...planDeps, adminAuth }, limits: rateLimits });
  return app;
}
