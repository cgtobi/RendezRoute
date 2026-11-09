// Host links (/a), manage links (/m) and template links (/t): confirm on GET, link on POST
// (spec 3.2, decision D1).
import type { Hono } from "hono";
import type { AppEnv } from "../app.tsx";
import { readDeviceToken, setDeviceToken } from "../device-cookie.ts";
import { SecretLinkConfirm, SecretLinkHead } from "../views/secret-link.tsx";
import { linkKinds } from "./link-kinds.ts";
import { badRequest, formField, readForm, type RouteDeps, secretLinkHeaders } from "./shared.tsx";

/**
 * Paths that carry a secret token (spec 3.2): host, manage and template links, and calendar feeds.
 * They must never be echoed into other URLs.
 */
export function isSecretLinkPath(path: string): boolean {
  return /^\/(?:a|m|t|c)(?:\/|$)/.test(path);
}

export function registerSecretLinkRoutes(app: Hono<AppEnv>, { config, planDeps }: RouteDeps) {
  for (const [, kind] of linkKinds()) {
    app.get(`${kind.secretPath}/:token`, async (c) => {
      const token = c.req.param("token");
      const t = c.get("t");
      const result = await kind.open(planDeps, { token, deviceToken: readDeviceToken(c, config) });
      secretLinkHeaders(c);
      switch (result.kind) {
        case "not_found":
          c.status(404);
          return c.render(<p>{t("hostLink.invalid")}</p>, { head: <SecretLinkHead t={t} /> });
        case "already_linked":
          return c.redirect(kind.landing(result.id), 303);
        case "confirm":
          c.header("x-robots-tag", "noindex");
          return c.render(
            <SecretLinkConfirm
              t={t}
              heading={t(kind.confirmTexts.heading)}
              body={t(kind.confirmTexts.body, { title: result.title })}
              warning={t(kind.confirmTexts.warning)}
              action={kind.secretPath}
              token={token}
              csrfToken={c.get("csrfToken")()}
            />,
            { title: t(kind.confirmTexts.heading), head: <SecretLinkHead t={t} /> },
          );
      }
    });

    app.post(kind.secretPath, async (c) => {
      const body = await readForm(c);
      if (body === undefined) return badRequest(c);
      const result = await kind.confirm(planDeps, {
        token: formField(body, "token"),
        deviceToken: readDeviceToken(c, config),
      });
      secretLinkHeaders(c);
      if (result.kind === "not_found") {
        c.status(404);
        return c.render(<p>{c.get("t")("hostLink.invalid")}</p>);
      }
      if (result.newDeviceToken !== undefined) setDeviceToken(c, config, result.newDeviceToken);
      return c.redirect(kind.landing(result.id), 303);
    });
  }
}
