// "Get a new link", "Email me my links" and "Sign out all other devices" for host, manage and
// template links (spec 3.2, decisions I44, D31): POST <page>/link shows the new link once,
// POST <page>/link/email sends it and returns to the page, POST <page>/sign-out returns too.
import type { Context, Hono } from "hono";
import {
  emailNewLink,
  getNewLink,
  type LinkKind,
  newLinkAddress,
  signOutOtherDevices,
} from "../../../../application/links.ts";
import type { PlanDeps } from "../../../../application/plans.ts";
import type { AppEnv } from "../app.tsx";
import { readDeviceToken } from "../device-cookie.ts";
import {
  AlreadyIssuedPage,
  FROM_MY_DATA,
  type LinkEmail,
  NewLinkPage,
} from "../views/link-tools.tsx";
import { takeEmailLimits } from "./email.tsx";
import { linkKinds } from "./link-kinds.ts";
import {
  badRequest,
  formField,
  linkEmailOutcome,
  planGone,
  readForm,
  type RouteDeps,
  secretLinkHeaders,
  templateGone,
  tooManyRequests,
} from "./shared.tsx";

/** "Email me my links" on an item's page: the address the button names, and the last outcome. */
export async function linkEmailProps(
  c: Context<AppEnv>,
  planDeps: PlanDeps,
  request: { kind: LinkKind; id: string; deviceToken: string | undefined },
): Promise<LinkEmail> {
  return { address: await newLinkAddress(planDeps, request), outcome: linkEmailOutcome(c) };
}

export function registerLinkToolRoutes(app: Hono<AppEnv>, { config, planDeps, limits }: RouteDeps) {
  for (const [kind, settings] of linkKinds()) {
    const request = (c: Context<AppEnv>) => ({
      kind,
      id: c.req.param("id") ?? "",
      deviceToken: readDeviceToken(c, config),
    });
    const page = (c: Context<AppEnv>) => settings.toolsPage.replace(":id", request(c).id);
    /** The item's page, or "My data" when the tools were used there (a fixed path, no redirect target). */
    const backTo = (c: Context<AppEnv>, from: string) =>
      from === FROM_MY_DATA.value ? "/my-data" : page(c);
    // As elsewhere: templates have no public page, plans send others back to theirs.
    const denied = (c: Context<AppEnv>, result: "not_found" | "forbidden") => {
      if (kind === "template") return templateGone(c);
      return result === "not_found" ? planGone(c) : c.redirect(`/p/${request(c).id}`, 303);
    };

    app.post(`${settings.toolsPage}/link`, async (c) => {
      const body = await readForm(c);
      if (body === undefined) return badRequest(c);
      const back = backTo(c, formField(body, FROM_MY_DATA.name));
      const result = await getNewLink(planDeps, {
        ...request(c),
        formNonce: formField(body, "nonce"),
      });
      const t = c.get("t");
      switch (result.kind) {
        case "not_found":
        case "forbidden":
          return denied(c, result.kind);
        case "bad_request":
          return badRequest(c);
        case "already_issued":
          // A resent form: the link shown the first time keeps working.
          c.header("cache-control", "no-store");
          return c.render(<AlreadyIssuedPage t={t} backPath={back} />, {
            title: t("linkTools.newHeading"),
          });
        case "issued":
          secretLinkHeaders(c);
          return c.render(
            <NewLinkPage
              t={t}
              label={t(settings.newLinkTexts.label)}
              url={new URL(`${settings.secretPath}/${result.token}`, config.baseUrl).href}
              warning={t(settings.newLinkTexts.warning)}
              backPath={back}
            />,
            { title: t("linkTools.newHeading") },
          );
      }
    });

    // "Email me my links" (decision D31): back to the item's page, which says how it went.
    app.post(`${settings.toolsPage}/link/email`, async (c) => {
      const body = await readForm(c);
      if (body === undefined) return badRequest(c);
      // Counted per client and per address, like confirmation links: whoever holds the item's
      // link cannot flood its owner's mailbox (spec 3.11).
      const address = await newLinkAddress(planDeps, request(c));
      if (address === undefined) return c.redirect(page(c), 303);
      const taken = takeEmailLimits(c, limits, address);
      if (!taken.ok) return tooManyRequests(c, taken.retryAfterSeconds);
      const result = await emailNewLink(planDeps, {
        ...request(c),
        formNonce: formField(body, "nonce"),
        linkUrl: (token) => new URL(`${settings.secretPath}/${token}`, config.baseUrl).href,
      });
      if (result.kind !== "sent") taken.refund();
      switch (result.kind) {
        case "not_found":
        case "forbidden":
          return denied(c, result.kind);
        case "bad_request":
          return badRequest(c);
        case "sent":
          return c.redirect(`${page(c)}?linkEmailed=sent`, 303);
        case "not_sent":
          return c.redirect(`${page(c)}?linkEmailed=failed`, 303);
        case "already_issued":
        case "no_address":
          return c.redirect(page(c), 303);
      }
    });

    app.post(`${settings.toolsPage}/sign-out`, async (c) => {
      const body = await readForm(c);
      if (body === undefined) return badRequest(c);
      const result = await signOutOtherDevices(planDeps, request(c));
      if (result.kind !== "signed_out") return denied(c, result.kind);
      const back = backTo(c, formField(body, FROM_MY_DATA.name));
      return c.redirect(`${back}?signedOut=${result.devices}`, 303);
    });
  }
}
