// The link every email, ntfy and Telegram message carries, `/e/<token>` (spec 7 Optional
// notification channels, decisions D31, D33, D34): it confirms the channel, refuses it, or later
// turns it off. Like other secret links it changes nothing on GET (decision D1), since mail
// scanners open links; the mail app's one-click unsubscribe posts to the link itself (RFC 8058).
import type { Context, Hono } from "hono";
import { openChannelLink, useChannelLink } from "../../../../application/channel-links.ts";
import type { ConfirmableChannel } from "../../../../application/ports.ts";
import type { MessageKey } from "../../../i18n/messages/en.ts";
import type { AppEnv } from "../app.tsx";
import { CSRF_FIELD } from "../csrf.ts";
import { SecretLinkHead } from "../views/secret-link.tsx";
import {
  badRequest,
  formField,
  messagePage,
  readForm,
  type RouteDeps,
  secretLinkHeaders,
} from "./shared.tsx";

/** The path a channel's link has, and that a one-click unsubscribe posts to. */
export const CHANNEL_LINK_PATH = /^\/e\/[^/]+$/;

/** The page's texts for one kind of channel; the bodies per subject: a plan or the account. */
interface LinkTexts {
  confirmHeading: MessageKey;
  offHeading: MessageKey;
  confirmBody: MessageKey;
  accountConfirmBody: MessageKey;
  offBody: MessageKey;
  accountOffBody: MessageKey;
  confirm: MessageKey;
  refuse: MessageKey;
  off: MessageKey;
  confirmed: MessageKey;
  turnedOff: MessageKey;
}

const TEXTS: Readonly<Record<ConfirmableChannel["kind"], LinkTexts>> = {
  email: {
    confirmHeading: "emailLink.confirmHeading",
    offHeading: "emailLink.offHeading",
    confirmBody: "emailLink.confirmBody",
    accountConfirmBody: "emailLink.accountConfirmBody",
    offBody: "emailLink.offBody",
    accountOffBody: "emailLink.accountOffBody",
    confirm: "emailLink.confirm",
    refuse: "emailLink.refuse",
    off: "emailLink.off",
    confirmed: "emailLink.confirmed",
    turnedOff: "emailLink.turnedOff",
  },
  ntfy: {
    confirmHeading: "ntfyLink.confirmHeading",
    offHeading: "ntfyLink.offHeading",
    confirmBody: "ntfyLink.confirmBody",
    accountConfirmBody: "ntfyLink.accountConfirmBody",
    offBody: "ntfyLink.offBody",
    accountOffBody: "ntfyLink.accountOffBody",
    confirm: "ntfyLink.confirm",
    refuse: "ntfyLink.refuse",
    off: "ntfyLink.off",
    confirmed: "ntfyLink.confirmed",
    turnedOff: "ntfyLink.turnedOff",
  },
  // Telegram is confirmed by Start in the bot, so its link only ever turns off (decision D34).
  telegram: {
    confirmHeading: "telegramLink.offHeading",
    offHeading: "telegramLink.offHeading",
    confirmBody: "telegramLink.offBody",
    accountConfirmBody: "telegramLink.accountOffBody",
    offBody: "telegramLink.offBody",
    accountOffBody: "telegramLink.accountOffBody",
    confirm: "telegramLink.off",
    refuse: "telegramLink.off",
    off: "telegramLink.off",
    confirmed: "telegramLink.turnedOff",
    turnedOff: "telegramLink.turnedOff",
  },
};

const text = (kind: ConfirmableChannel["kind"], name: keyof LinkTexts): MessageKey =>
  TEXTS[kind][name];

export function registerChannelLinkRoutes(app: Hono<AppEnv>, { config, planDeps }: RouteDeps) {
  const invalid = (c: Context<AppEnv>) => {
    secretLinkHeaders(c);
    return messagePage(c, 404, c.get("t")("channelLink.invalid"));
  };

  app.get("/e/:token", async (c) => {
    const token = c.req.param("token");
    const t = c.get("t");
    const result = await openChannelLink(planDeps, token);
    if (result.kind === "not_found") return invalid(c);
    secretLinkHeaders(c);
    c.header("x-robots-tag", "noindex");
    const kind = result.channel;
    const confirm = result.kind === "confirm";
    const heading = t(text(kind, confirm ? "confirmHeading" : "offHeading"));
    const values = { instance: config.instanceName, address: result.address ?? "" };
    const body =
      result.subject.kind === "plan"
        ? t(text(kind, confirm ? "confirmBody" : "offBody"), {
            ...values,
            title: result.subject.planTitle,
          })
        : t(text(kind, confirm ? "accountConfirmBody" : "accountOffBody"), values);
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
        <p>{body}</p>
        {confirm ? (
          <div class="button-row">
            {action("confirm", t(text(kind, "confirm")), undefined)}
            {action("off", t(text(kind, "refuse")), "secondary")}
          </div>
        ) : (
          action("off", t(text(kind, "off")), "danger")
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
    const result = await useChannelLink(planDeps, { token: formField(body, "token"), action });
    if (result.kind === "not_found") return invalid(c);
    secretLinkHeaders(c);
    const t = c.get("t");
    return messagePage(
      c,
      200,
      t(text(result.channel, result.kind === "confirmed" ? "confirmed" : "turnedOff")),
    );
  });

  // One click from the mail app (RFC 8058): no cookie and no form token, the link is the secret.
  // Only turning off, and only with the body the RFC prescribes.
  app.post("/e/:token", async (c) => {
    const body = await readForm(c);
    if (formField(body ?? {}, "List-Unsubscribe") !== "One-Click") return badRequest(c);
    await useChannelLink(planDeps, { token: c.req.param("token"), action: "off" });
    secretLinkHeaders(c);
    return c.text("", 200);
  });
}
