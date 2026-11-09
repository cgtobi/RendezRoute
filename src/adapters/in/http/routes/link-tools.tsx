// "Get a new link" and "Sign out all other devices" for host, manage and template links (spec 3.2,
// decision I44): POST <page>/link shows the new link once, POST <page>/sign-out returns to the page.
import type { Context, Hono } from "hono";
import { getNewLink, signOutOtherDevices } from "../../../../application/links.ts";
import type { AppEnv } from "../app.tsx";
import { readDeviceToken } from "../device-cookie.ts";
import { AlreadyIssuedPage, FROM_MY_DATA, NewLinkPage } from "../views/link-tools.tsx";
import { linkKinds } from "./link-kinds.ts";
import {
  badRequest,
  formField,
  planGone,
  readForm,
  type RouteDeps,
  secretLinkHeaders,
  templateGone,
} from "./shared.tsx";

export function registerLinkToolRoutes(app: Hono<AppEnv>, { config, planDeps }: RouteDeps) {
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
