// ntfy on the manage, host and account pages (spec 7 Optional notification channels, decision
// D33): setting up a topic (which posts the confirmation link to it), posting that link again,
// and turning it off. Each setup counts against the notification limit, like turning push on.
import type { Context, Hono } from "hono";
import type { SwitchRequest } from "../../../../application/channels.ts";
import {
  accountNtfySetting,
  ntfySetting,
  requestAccountNtfy,
  requestNtfy,
  turnOffAccountNtfy,
  turnOffNtfy,
} from "../../../../application/ntfy.ts";
import type { PlanDeps } from "../../../../application/plans.ts";
import type { AppEnv } from "../app.tsx";
import { readDeviceToken } from "../device-cookie.ts";
import type { NtfySwitchProps } from "../views/more-channels.tsx";
import { clientOf, type RouteDeps, switchRoute, tooManyRequests } from "./shared.tsx";

/** The ntfy part of a manage or host page; undefined without NTFY_URL or for someone else. */
export async function ntfyProps(
  planDeps: PlanDeps,
  request: SwitchRequest,
  base: string,
): Promise<NtfySwitchProps | undefined> {
  const setting = await ntfySetting(planDeps, request);
  return setting.kind === "setting"
    ? { setting, base, shared: request.role === "host" }
    : undefined;
}

/** The account page's ntfy part. */
export async function accountNtfyProps(
  planDeps: PlanDeps,
  deviceToken: string | undefined,
): Promise<NtfySwitchProps | undefined> {
  const setting = await accountNtfySetting(planDeps, { deviceToken });
  return setting.kind === "setting" ? { setting, base: "/account", forAccount: true } : undefined;
}

/**
 * Each setup posts to the instance's server: counted per client (spec 3.11), and given back when
 * nothing was posted, like confirmation emails.
 */
async function limited(
  c: Context<AppEnv>,
  limits: RouteDeps["limits"],
  run: () => Promise<{ kind: string }>,
): Promise<Response | { kind: string }> {
  const client = clientOf(c);
  const allowed = limits.notify.take(client);
  if (!allowed.ok) return tooManyRequests(c, allowed.retryAfterSeconds);
  const result = await run();
  if (result.kind !== "sent") limits.notify.refund(client);
  return result;
}

/** `<base>/ntfy` and `<base>/ntfy/off` of a manage or host page. */
export function registerNtfyForms(
  app: Hono<AppEnv>,
  { config, planDeps, limits }: RouteDeps,
  { role, base }: { role: SwitchRequest["role"]; base: string },
) {
  const route = (c: Context<AppEnv>) => switchRoute(c, config, role, base);
  const back = (c: Context<AppEnv>, result: { kind: string }) =>
    c.redirect(
      result.kind === "not_found" || result.kind === "forbidden"
        ? route(c).plan
        : `${route(c).page}#ntfy`,
      303,
    );

  app.post(`${base}/ntfy`, async (c) => {
    const result = await limited(c, limits, () => requestNtfy(planDeps, route(c).request));
    return result instanceof Response ? result : back(c, result);
  });

  app.post(`${base}/ntfy/off`, async (c) => back(c, await turnOffNtfy(planDeps, route(c).request)));
}

/** `/account/ntfy` and `/account/ntfy/off`. */
export function registerAccountNtfyForms(
  app: Hono<AppEnv>,
  { config, planDeps, limits }: RouteDeps,
) {
  app.post("/account/ntfy", async (c) => {
    const result = await limited(c, limits, () =>
      requestAccountNtfy(planDeps, {
        deviceToken: readDeviceToken(c, config),
        // Account notices are written in the language the topic was set up in.
        language: c.get("language"),
      }),
    );
    return result instanceof Response ? result : c.redirect("/account#ntfy", 303);
  });

  app.post("/account/ntfy/off", async (c) => {
    await turnOffAccountNtfy(planDeps, { deviceToken: readDeviceToken(c, config) });
    return c.redirect("/account#ntfy", 303);
  });
}
