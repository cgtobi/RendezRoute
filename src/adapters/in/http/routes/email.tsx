// Email (spec 7 Optional notification channels, decisions D31, I55): the address forms on the
// manage, host and account pages, and lending the account's address. The link every email carries
// is in channel-links.tsx.
import { createHash } from "node:crypto";
import type { Context, Hono } from "hono";
import {
  accountEmailSetting,
  emailSetting,
  requestAccountEmail,
  requestEmail,
  turnOffAccountEmail,
  turnOffEmail,
  useAccountEmail,
} from "../../../../application/email.ts";
import type { SwitchRequest } from "../../../../application/channels.ts";
import type { PlanDeps } from "../../../../application/plans.ts";
import type { AppEnv } from "../app.tsx";
import { readDeviceToken } from "../device-cookie.ts";
import type { EmailSwitchProps } from "../views/email-switch.tsx";
import {
  badRequest,
  clientOf,
  formField,
  readForm,
  type RouteDeps,
  switchRoute,
  tooManyRequests,
} from "./shared.tsx";

type Role = SwitchRequest["role"];

/** Re-renders the manage, host or account page with the refused address and its error. */
export type EmailRerender = (
  c: Context<AppEnv>,
  form: { value: string; error: string },
) => Response | Promise<Response>;

/** The email part of a manage or host page; undefined without SMTP or for someone else. */
export async function emailProps(
  planDeps: PlanDeps,
  request: SwitchRequest,
  base: string,
  form?: { value: string; error: string },
): Promise<EmailSwitchProps | undefined> {
  const setting = await emailSetting(planDeps, request);
  return setting.kind === "setting"
    ? { setting, base, form, shared: request.role === "host" }
    : undefined;
}

/** The account page's email part; undefined without SMTP and no stored address. */
export async function accountEmailProps(
  planDeps: PlanDeps,
  deviceToken: string | undefined,
  form?: { value: string; error: string },
): Promise<EmailSwitchProps | undefined> {
  const setting = await accountEmailSetting(planDeps, { deviceToken });
  return setting.kind === "setting"
    ? { setting, base: "/account", form, forAccount: true }
    : undefined;
}

/**
 * Each request for a confirmation link, or for a new link by email, counts per client and per
 * address, so the forms cannot be used to flood someone's mailbox (spec 3.11). The address key lives only in memory; both are
 * given back when no link was sent.
 */
export function takeEmailLimits(
  c: Context<AppEnv>,
  limits: RouteDeps["limits"],
  address: string,
): { ok: true; refund: () => void } | { ok: false; retryAfterSeconds: number } {
  const client = clientOf(c);
  const addressKey = createHash("sha256").update(address.trim().toLowerCase()).digest("hex");
  const byClient = limits.email.take(client);
  if (!byClient.ok) return byClient;
  const byAddress = limits.emailAddress.take(addressKey);
  if (!byAddress.ok) {
    limits.email.refund(client);
    return byAddress;
  }
  return {
    ok: true,
    refund: () => {
      limits.email.refund(client);
      limits.emailAddress.refund(addressKey);
    },
  };
}

/**
 * The address forms of one page: `<base>/email`, `<base>/email/off`, and `<base>/email/account`
 * to use the logged-in account's confirmed address.
 */
export function registerEmailForms(
  app: Hono<AppEnv>,
  { config, planDeps, limits }: RouteDeps,
  { role, base, rerender }: { role: Role; base: string; rerender: EmailRerender },
) {
  const route = (c: Context<AppEnv>) => switchRoute(c, config, role, base);
  const request = (c: Context<AppEnv>): SwitchRequest => route(c).request;
  const page = (c: Context<AppEnv>) => route(c).page;
  const plan = (c: Context<AppEnv>) => route(c).plan;

  app.post(`${base}/email`, async (c) => {
    const body = await readForm(c);
    if (body === undefined) return badRequest(c);
    const address = formField(body, "address");
    const taken = takeEmailLimits(c, limits, address);
    if (!taken.ok) return tooManyRequests(c, taken.retryAfterSeconds);
    const result = await requestEmail(planDeps, { ...request(c), address });
    if (result.kind !== "sent") taken.refund();
    switch (result.kind) {
      case "sent":
      case "unchanged":
      case "unavailable":
        return c.redirect(page(c), 303);
      case "not_found":
      case "forbidden":
        return c.redirect(plan(c), 303);
      case "invalid":
        c.status(422);
        return rerender(c, { value: address, error: result.error });
    }
  });

  app.post(`${base}/email/account`, async (c) => {
    const result = await useAccountEmail(planDeps, request(c));
    const denied = result.kind === "not_found" || result.kind === "forbidden";
    return c.redirect(denied ? plan(c) : page(c), 303);
  });

  app.post(`${base}/email/off`, async (c) => {
    const result = await turnOffEmail(planDeps, request(c));
    return c.redirect(result.kind === "off" ? page(c) : plan(c), 303);
  });
}

/** The account page's address (decision D31): `/account/email` and `/account/email/off`. */
export function registerAccountEmailForms(
  app: Hono<AppEnv>,
  { config, planDeps, limits }: RouteDeps,
  rerender: EmailRerender,
) {
  app.post("/account/email", async (c) => {
    const body = await readForm(c);
    if (body === undefined) return badRequest(c);
    const address = formField(body, "address");
    const taken = takeEmailLimits(c, limits, address);
    if (!taken.ok) return tooManyRequests(c, taken.retryAfterSeconds);
    const result = await requestAccountEmail(planDeps, {
      deviceToken: readDeviceToken(c, config),
      address,
      // Account notices are written in the language the address was set in.
      language: c.get("language"),
    });
    if (result.kind !== "sent") taken.refund();
    if (result.kind !== "invalid") return c.redirect("/account", 303);
    c.status(422);
    return rerender(c, { value: address, error: result.error });
  });

  app.post("/account/email/off", async (c) => {
    await turnOffAccountEmail(planDeps, { deviceToken: readDeviceToken(c, config) });
    return c.redirect("/account", 303);
  });
}
