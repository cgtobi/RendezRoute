// Email notifications (spec 7 Optional notification channels, decision D31): the address forms on
// the manage and host pages, and the link every email carries, which confirms the address and later
// turns the emails off. Like other secret links it changes nothing on GET (decision D1), since mail
// scanners open links; the mail app's one-click unsubscribe posts to the link itself (RFC 8058).
import { createHash } from "node:crypto";
import type { Context, Hono } from "hono";
import {
  emailSetting,
  openEmailLink,
  requestEmail,
  turnOffEmail,
  useEmailLink,
} from "../../../../application/email.ts";
import type { SwitchRequest } from "../../../../application/channels.ts";
import type { PlanDeps } from "../../../../application/plans.ts";
import type { AppEnv } from "../app.tsx";
import { CSRF_FIELD } from "../csrf.ts";
import { readDeviceToken } from "../device-cookie.ts";
import type { EmailSwitchProps } from "../views/email-switch.tsx";
import { SecretLinkHead } from "../views/secret-link.tsx";
import {
  badRequest,
  clientOf,
  formField,
  messagePage,
  readForm,
  type RouteDeps,
  secretLinkHeaders,
  tooManyRequests,
} from "./shared.tsx";

/** The path an email's link has, and that a one-click unsubscribe posts to. */
export const EMAIL_LINK_PATH = /^\/e\/[^/]+$/;

type Role = SwitchRequest["role"];

/** Re-renders the manage or host page with the refused address and its error. */
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
  return setting.kind === "setting" ? { setting, base, form } : undefined;
}

/** The address forms of one page: `<base>/email` and `<base>/email/off`. */
export function registerEmailForms(
  app: Hono<AppEnv>,
  { config, planDeps, limits }: RouteDeps,
  { role, base, rerender }: { role: Role; base: string; rerender: EmailRerender },
) {
  const request = (c: Context<AppEnv>): SwitchRequest => ({
    planId: c.req.param("id") ?? "",
    deviceToken: readDeviceToken(c, config),
    role,
  });
  const page = (c: Context<AppEnv>) => base.replace(":id", request(c).planId);

  app.post(`${base}/email`, async (c) => {
    const body = await readForm(c);
    if (body === undefined) return badRequest(c);
    const address = formField(body, "address");
    // Each attempt counts per client and per address, so the form cannot be used to flood
    // someone's mailbox with confirmation links (spec 3.11). The address key lives only in memory.
    const client = clientOf(c);
    const addressKey = createHash("sha256").update(address.trim().toLowerCase()).digest("hex");
    const byClient = limits.email.take(client);
    if (!byClient.ok) return tooManyRequests(c, byClient.retryAfterSeconds);
    const byAddress = limits.emailAddress.take(addressKey);
    if (!byAddress.ok) {
      limits.email.refund(client);
      return tooManyRequests(c, byAddress.retryAfterSeconds);
    }
    const result = await requestEmail(planDeps, { ...request(c), address });
    if (result.kind !== "sent") {
      limits.email.refund(client);
      limits.emailAddress.refund(addressKey);
    }
    switch (result.kind) {
      case "sent":
      case "unchanged":
      case "unavailable":
        return c.redirect(page(c), 303);
      case "not_found":
      case "forbidden":
        return c.redirect(`/p/${request(c).planId}`, 303);
      case "invalid":
        c.status(422);
        return rerender(c, { value: address, error: result.error });
    }
  });

  app.post(`${base}/email/off`, async (c) => {
    const result = await turnOffEmail(planDeps, request(c));
    return c.redirect(result.kind === "off" ? page(c) : `/p/${request(c).planId}`, 303);
  });
}

/** The link in every email: `/e/<token>`. */
export function registerEmailLinkRoutes(app: Hono<AppEnv>, { planDeps }: RouteDeps) {
  const invalid = (c: Context<AppEnv>) => {
    secretLinkHeaders(c);
    return messagePage(c, 404, c.get("t")("emailLink.invalid"));
  };

  app.get("/e/:token", async (c) => {
    const token = c.req.param("token");
    const t = c.get("t");
    const result = await openEmailLink(planDeps, token);
    if (result.kind === "not_found") return invalid(c);
    secretLinkHeaders(c);
    c.header("x-robots-tag", "noindex");
    const confirm = result.kind === "confirm";
    const heading = t(confirm ? "emailLink.confirmHeading" : "emailLink.offHeading");
    const values = { title: result.planTitle, address: result.address };
    const csrfToken = c.get("csrfToken")();
    const action = (name: "confirm" | "off", label: string, style: string | undefined) => (
      <form method="post" action="/e">
        <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="action" value={name} />
        <button type="submit" class={style}>
          {label}
        </button>
      </form>
    );
    // Whoever got the confirmation without asking for it can refuse it here (decision D31).
    return c.render(
      <section>
        <h1>{heading}</h1>
        <p>{t(confirm ? "emailLink.confirmBody" : "emailLink.offBody", values)}</p>
        {confirm ? (
          <div class="button-row">
            {action("confirm", t("emailLink.confirm"), undefined)}
            {action("off", t("emailLink.refuse"), "secondary")}
          </div>
        ) : (
          action("off", t("emailLink.off"), "danger")
        )}
      </section>,
      { title: heading, head: <SecretLinkHead t={t} /> },
    );
  });

  // From the link's page: the token in the body, as for the other secret links (decision D1).
  app.post("/e", async (c) => {
    const body = await readForm(c);
    if (body === undefined) return badRequest(c);
    const action = formField(body, "action");
    if (action !== "confirm" && action !== "off") return badRequest(c);
    const result = await useEmailLink(planDeps, { token: formField(body, "token"), action });
    if (result.kind === "not_found") return invalid(c);
    secretLinkHeaders(c);
    const t = c.get("t");
    return messagePage(
      c,
      200,
      t(result.kind === "confirmed" ? "emailLink.confirmed" : "emailLink.turnedOff"),
    );
  });

  // One click from the mail app (RFC 8058): no cookie and no form token, the link is the secret.
  // Only turning off, and only with the body the RFC prescribes.
  app.post("/e/:token", async (c) => {
    const body = await readForm(c);
    if (formField(body ?? {}, "List-Unsubscribe") !== "One-Click") return badRequest(c);
    await useEmailLink(planDeps, { token: c.req.param("token"), action: "off" });
    secretLinkHeaders(c);
    return c.text("", 200);
  });
}
