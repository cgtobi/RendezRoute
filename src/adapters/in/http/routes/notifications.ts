// Notification switches (spec 6 feature 3, decision D17): JSON endpoints for the browser script,
// CSRF-protected by header like place search. One set for a response, one for the host.
import type { Context, Hono } from "hono";
import { notificationStatus, subscribe, unsubscribe } from "../../../../application/channels.ts";
import type { Denied } from "../../../../application/host.ts";
import type { PlanDeps } from "../../../../application/plans.ts";
import type { Config } from "../../../../config.ts";
import type { AppEnv } from "../app.tsx";
import { readDeviceToken } from "../device-cookie.ts";
import type { RateLimits } from "../rate-limit.ts";
import { clientOf } from "./shared.tsx";

const ROLES = [
  ["responder", "/p/:id/me/notifications"],
  ["host", "/p/:id/host/notifications"],
] as const;

async function readJson(c: Context<AppEnv>): Promise<Record<string, unknown> | undefined> {
  try {
    const body: unknown = await c.req.json();
    return typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

type SwitchResult =
  | Denied
  | { kind: "invalid" }
  | { kind: "subscribed" }
  | { kind: "unsubscribed" }
  | { kind: "status"; enabled: boolean };

/** Maps a use-case result to JSON; never cached. */
function answer(c: Context<AppEnv>, result: SwitchResult) {
  c.header("cache-control", "no-store");
  switch (result.kind) {
    case "not_found":
      return c.json({ error: "not_found" }, 404);
    case "forbidden":
      return c.json({ error: "forbidden" }, 403);
    case "invalid":
      return c.json({ error: "invalid" }, 400);
    case "subscribed":
      return c.json({ enabled: true });
    case "unsubscribed":
      return c.json({ enabled: false });
    case "status":
      return c.json({ enabled: result.enabled });
  }
}

export function registerNotificationRoutes(
  app: Hono<AppEnv>,
  { config, planDeps, limits }: { config: Config; planDeps: PlanDeps; limits: RateLimits },
): void {
  for (const [role, path] of ROLES) {
    const who = (c: Context<AppEnv>) => ({
      planId: c.req.param("id") ?? "",
      deviceToken: readDeviceToken(c, config),
      role,
    });

    app.post(path, async (c) => {
      // Every attempt counts, so no client can register endless subscriptions (spec 3.11).
      const allowed = limits.notify.take(clientOf(c));
      if (!allowed.ok) {
        c.header("cache-control", "no-store");
        c.header("retry-after", String(allowed.retryAfterSeconds));
        return c.json({ error: "rate_limited" }, 429);
      }
      const body = await readJson(c);
      if (body === undefined) return answer(c, { kind: "invalid" });
      return answer(c, await subscribe(planDeps, { ...who(c), subscription: body.subscription }));
    });

    for (const [action, run] of [
      ["status", notificationStatus],
      ["off", unsubscribe],
    ] as const) {
      app.post(`${path}/${action}`, async (c) => {
        const body = await readJson(c);
        if (body === undefined || typeof body.endpoint !== "string") {
          return answer(c, { kind: "invalid" });
        }
        return answer(c, await run(planDeps, { ...who(c), endpoint: body.endpoint }));
      });
    }
  }
}
