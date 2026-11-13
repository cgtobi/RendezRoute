// Fediverse direct messages on the account page (spec 7 Optional notification channels, decision
// D47): switching on looks the account's own login address up (an outbound request, so counted
// per client) and, only if it resolves, stores the choice and queues the first message. No route
// takes an address from the request: the recipient is the logged-in account's own login.
import type { Context, Hono } from "hono";
import type { AccountDeps } from "../../../../application/accounts.ts";
import { accountOf } from "../../../../application/channel-links.ts";
import {
  fediverseMessagesSetting,
  turnOffFediverseMessages,
  turnOnFediverseMessages,
} from "../../../../application/fediverse-messages.ts";
import type { AppEnv } from "../app.tsx";
import { readDeviceToken } from "../device-cookie.ts";
import type { FediverseMessagesSwitchProps } from "../views/more-channels.tsx";
import { clientOf, type RouteDeps, tooManyRequests } from "./shared.tsx";

/** The account page's part; undefined without a fediverse login or while federation is off. */
export async function accountFediverseMessagesProps(
  deps: AccountDeps,
  deviceToken: string | undefined,
  instance: string,
  failed: boolean | undefined,
): Promise<FediverseMessagesSwitchProps | undefined> {
  const setting = await fediverseMessagesSetting(deps, { deviceToken });
  return setting.kind === "setting"
    ? { setting, instance, ...(failed === true ? { failed } : {}) }
    : undefined;
}

/** `/account/fediverse-messages` and `/account/fediverse-messages/off`. */
export function registerAccountFediverseMessagesForms(
  app: Hono<AppEnv>,
  { config, limits }: RouteDeps,
  deps: AccountDeps,
  renderFailed: (c: Context<AppEnv>) => Promise<Response>,
) {
  app.post("/account/fediverse-messages", async (c) => {
    const client = clientOf(c);
    const allowed = limits.fediverseMessages.take(client);
    if (!allowed.ok) return tooManyRequests(c, allowed.retryAfterSeconds);
    // Also per account, whatever clients it comes from: each switch-on may send a message.
    const account = (await accountOf(deps, readDeviceToken(c, config)))?.identityId;
    if (account !== undefined) {
      const accountAllowed = limits.fediverseMessagesAccount.take(account);
      if (!accountAllowed.ok) {
        limits.fediverseMessages.refund(client);
        return tooManyRequests(c, accountAllowed.retryAfterSeconds);
      }
    }
    const result = await turnOnFediverseMessages(deps, {
      deviceToken: readDeviceToken(c, config),
      // Account notices are written in the language the channel was switched on in.
      language: c.get("language"),
    });
    // Only a lookup counts; nothing was looked up when it was already on or not available.
    if (result.kind === "unchanged" || result.kind === "unavailable") {
      limits.fediverseMessages.refund(client);
      if (account !== undefined) limits.fediverseMessagesAccount.refund(account);
    }
    if (result.kind === "unresolved") {
      c.status(422);
      return renderFailed(c);
    }
    return c.redirect("/account#fediverse-messages", 303);
  });

  app.post("/account/fediverse-messages/off", async (c) => {
    await turnOffFediverseMessages(deps, { deviceToken: readDeviceToken(c, config) });
    return c.redirect("/account#fediverse-messages", 303);
  });
}
