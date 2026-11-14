// The admin-only app (decision D55): the instance admin pages on their own listener, composed
// from the same stack as the public app (app-common.tsx) but with no Fedify, no inbox and no
// public routes, and with its own CSRF key, cookie and origin rule (admin-listener.ts).
import { Hono } from "hono";
import type { PlanDeps } from "../../../application/plans.ts";
import type { AdminAuth, IngressAdminAuth } from "../../../application/ports.ts";
import type { Config } from "../../../config.ts";
import type { Logger } from "../../logging.ts";
import { adminCsrfOptions } from "./admin-listener.ts";
import type { AppEnv } from "./app.tsx";
import { composeCommonStack } from "./app-common.tsx";
import { ingressGate } from "./ingress-guard.ts";
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
  /**
   * Home Assistant Ingress mode (decision D56): set exactly when `config.admin.ingress` is, and
   * then the same object as `adminAuth`. No login, no cookie; the Supervisor's identity is checked on
   * every request and the forms carry a token bound to its user (decision I74).
   */
  ingress?: IngressAdminAuth | undefined;
}

export function createAdminApp({
  config,
  csrfKey,
  logger,
  planDeps,
  rateLimits,
  adminAuth,
  ingress,
}: AdminAppDeps): Hono<AppEnv> {
  if (config.admin === undefined) throw new Error("createAdminApp needs ADMIN_PORT");
  if ((config.admin.ingress !== undefined) !== (ingress !== undefined)) {
    throw new Error("createAdminApp needs the Ingress auth exactly in Ingress mode");
  }
  const app = new Hono<AppEnv>();
  composeCommonStack(app, {
    config,
    logger,
    csrf:
      ingress === undefined
        ? { key: csrfKey, ...adminCsrfOptions(config) }
        : { ingressToken: { key: csrfKey, now: () => planDeps.clock.now() } },
    // The Home Assistant frontend frames the pages and is same-origin with them.
    ...(ingress === undefined ? {} : { frameAncestors: "'self'" as const }),
    // After the body limit, before anything else is served (assets and /healthz included): only the
    // Supervisor, for an admin.
    ...(ingress === undefined ? {} : { beforeCsrf: (stack) => stack.use(ingressGate(ingress)) }),
    adminListener: true,
    // Refusals, not-found and error pages behind a path prefix: relative links (shared.tsx).
    ...(ingress === undefined ? {} : { relativeLinks: true }),
  });
  // Relative, so a path prefix in front of the listener (Home Assistant Ingress) keeps working.
  app.get("/", (c) => c.redirect("admin/", 303));
  registerAdminRoutes(app, {
    config,
    adminDeps: { ...planDeps, adminAuth },
    limits: rateLimits,
    ingress,
  });
  return app;
}
