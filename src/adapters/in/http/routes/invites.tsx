// Invite links (/i, spec 7 Moderation): confirm on GET, let the device post on POST (decision D1).
// Registered only with POSTING_MODE=invite.
import type { Hono } from "hono";
import { confirmInvite, openInvite } from "../../../../application/posting.ts";
import type { AppEnv } from "../app.tsx";
import { readDeviceToken, setDeviceToken } from "../device-cookie.ts";
import { SecretLinkConfirm, SecretLinkHead } from "../views/secret-link.tsx";
import { badRequest, formField, readForm, type RouteDeps, secretLinkHeaders } from "./shared.tsx";

/** Where a device that may post goes. */
const CREATE_FORM = "/new";

export function registerInviteRoutes(app: Hono<AppEnv>, { config, planDeps }: RouteDeps) {
  app.get("/i/:token", async (c) => {
    const t = c.get("t");
    const result = await openInvite(planDeps, {
      token: c.req.param("token"),
      deviceToken: readDeviceToken(c, config),
    });
    secretLinkHeaders(c);
    c.header("x-robots-tag", "noindex");
    switch (result.kind) {
      case "invalid":
        c.status(404);
        return c.render(<p>{t("invite.invalid")}</p>, { head: <SecretLinkHead t={t} /> });
      case "already_allowed":
        return c.redirect(CREATE_FORM, 303);
      case "confirm":
        return c.render(
          <SecretLinkConfirm
            t={t}
            heading={t("invite.heading")}
            body={t("invite.body", { instance: config.instanceName })}
            warning={t("invite.warning")}
            action="/i"
            token={c.req.param("token")}
            csrfToken={c.get("csrfToken")()}
          />,
          { title: t("invite.heading"), head: <SecretLinkHead t={t} /> },
        );
    }
  });

  app.post("/i", async (c) => {
    const body = await readForm(c);
    if (body === undefined) return badRequest(c);
    const result = await confirmInvite(planDeps, {
      token: formField(body, "token"),
      deviceToken: readDeviceToken(c, config),
    });
    secretLinkHeaders(c);
    if (result.kind === "invalid") {
      c.status(404);
      return c.render(<p>{c.get("t")("invite.invalid")}</p>);
    }
    if (result.newDeviceToken !== undefined) setDeviceToken(c, config, result.newDeviceToken);
    return c.redirect(CREATE_FORM, 303);
  });
}
