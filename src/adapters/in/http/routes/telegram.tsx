// Telegram on the manage, host and account pages (spec 7 Optional notification channels, decision
// D34): "Connect Telegram" makes the channel that waits for Start and shows the deep link into the
// bot; turning it off removes it. Each connect counts against the notification limit, given back
// when nothing changed, like ntfy.
import type { Context, Hono } from "hono";
import type { SwitchRequest } from "../../../../application/channels.ts";
import type { PlanDeps } from "../../../../application/plans.ts";
import {
  accountTelegramSetting,
  requestAccountTelegram,
  requestTelegram,
  telegramSetting,
  turnOffAccountTelegram,
  turnOffTelegram,
} from "../../../../application/telegram.ts";
import type { AppEnv } from "../app.tsx";
import { readDeviceToken } from "../device-cookie.ts";
import type { TelegramSwitchProps } from "../views/more-channels.tsx";
import { clientOf, type RouteDeps, switchRoute, tooManyRequests } from "./shared.tsx";

/** The Telegram part of a manage or host page; undefined without a bot or for someone else. */
export async function telegramProps(
  planDeps: PlanDeps,
  request: SwitchRequest,
  base: string,
): Promise<TelegramSwitchProps | undefined> {
  const setting = await telegramSetting(planDeps, request);
  return setting.kind === "setting"
    ? { setting, base, shared: request.role === "host" }
    : undefined;
}

export async function accountTelegramProps(
  planDeps: PlanDeps,
  deviceToken: string | undefined,
): Promise<TelegramSwitchProps | undefined> {
  const setting = await accountTelegramSetting(planDeps, { deviceToken });
  return setting.kind === "setting" ? { setting, base: "/account", forAccount: true } : undefined;
}

async function limited(
  c: Context<AppEnv>,
  limits: RouteDeps["limits"],
  run: () => Promise<{ kind: string }>,
): Promise<Response | { kind: string }> {
  const client = clientOf(c);
  const allowed = limits.notify.take(client);
  if (!allowed.ok) return tooManyRequests(c, allowed.retryAfterSeconds);
  const result = await run();
  if (result.kind !== "ready") limits.notify.refund(client);
  return result;
}

/** `<base>/telegram` and `<base>/telegram/off` of a manage or host page. */
export function registerTelegramForms(
  app: Hono<AppEnv>,
  { config, planDeps, limits }: RouteDeps,
  { role, base }: { role: SwitchRequest["role"]; base: string },
) {
  const route = (c: Context<AppEnv>) => switchRoute(c, config, role, base);
  const back = (c: Context<AppEnv>, result: { kind: string }) =>
    c.redirect(
      result.kind === "not_found" || result.kind === "forbidden"
        ? route(c).plan
        : `${route(c).page}#telegram`,
      303,
    );

  app.post(`${base}/telegram`, async (c) => {
    const result = await limited(c, limits, () => requestTelegram(planDeps, route(c).request));
    return result instanceof Response ? result : back(c, result);
  });

  app.post(`${base}/telegram/off`, async (c) =>
    back(c, await turnOffTelegram(planDeps, route(c).request)),
  );
}

/** `/account/telegram` and `/account/telegram/off`. */
export function registerAccountTelegramForms(
  app: Hono<AppEnv>,
  { config, planDeps, limits }: RouteDeps,
) {
  app.post("/account/telegram", async (c) => {
    const result = await limited(c, limits, () =>
      requestAccountTelegram(planDeps, {
        deviceToken: readDeviceToken(c, config),
        // Account notices are written in the language the chat was connected in.
        language: c.get("language"),
      }),
    );
    return result instanceof Response ? result : c.redirect("/account#telegram", 303);
  });

  app.post("/account/telegram/off", async (c) => {
    await turnOffAccountTelegram(planDeps, { deviceToken: readDeviceToken(c, config) });
    return c.redirect("/account#telegram", 303);
  });
}
