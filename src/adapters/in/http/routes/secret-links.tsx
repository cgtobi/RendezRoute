// Host links (/a), manage links (/m) and template links (/t): confirm on GET, link on POST
// (spec 3.2, decision D1).
import type { Hono } from "hono";
import {
  confirmHostLink,
  confirmManageLink,
  confirmTemplateLink,
  openHostLink,
  openManageLink,
  openTemplateLink,
} from "../../../../application/secret-links.ts";
import type { AppEnv } from "../app.tsx";
import { readDeviceToken, setDeviceToken } from "../device-cookie.ts";
import { SecretLinkConfirm, SecretLinkHead } from "../views/secret-link.tsx";
import { badRequest, formField, readForm, type RouteDeps, secretLinkHeaders } from "./shared.tsx";

/**
 * Paths that carry a secret token (spec 3.2): host, manage and template links, and calendar feeds.
 * They must never be echoed into other URLs.
 */
export function isSecretLinkPath(path: string): boolean {
  return /^\/(?:a|m|t|c)(?:\/|$)/.test(path);
}

const KINDS = {
  host: {
    path: "/a",
    open: openHostLink,
    confirm: confirmHostLink,
    target: (planId: string) => `/p/${planId}`,
    texts: {
      heading: "hostLink.heading",
      body: "hostLink.body",
      warning: "hostLink.sharedWarning",
    },
  },
  manage: {
    path: "/m",
    open: openManageLink,
    confirm: confirmManageLink,
    target: (planId: string) => `/p/${planId}/me`,
    texts: {
      heading: "manageLink.heading",
      body: "manageLink.body",
      warning: "manageLink.sharedWarning",
    },
  },
  template: {
    path: "/t",
    open: openTemplateLink,
    confirm: confirmTemplateLink,
    target: (templateId: string) => `/templates/${templateId}`,
    texts: {
      heading: "templateLink.heading",
      body: "templateLink.body",
      warning: "templateLink.sharedWarning",
    },
  },
} as const;

export function registerSecretLinkRoutes(app: Hono<AppEnv>, { config, planDeps }: RouteDeps) {
  for (const kind of Object.values(KINDS)) {
    app.get(`${kind.path}/:token`, async (c) => {
      const token = c.req.param("token");
      const t = c.get("t");
      const result = await kind.open(planDeps, { token, deviceToken: readDeviceToken(c, config) });
      secretLinkHeaders(c);
      switch (result.kind) {
        case "not_found":
          c.status(404);
          return c.render(<p>{t("hostLink.invalid")}</p>, { head: <SecretLinkHead t={t} /> });
        case "already_linked":
          return c.redirect(kind.target(result.id), 303);
        case "confirm":
          c.header("x-robots-tag", "noindex");
          return c.render(
            <SecretLinkConfirm
              t={t}
              heading={t(kind.texts.heading)}
              body={t(kind.texts.body, { title: result.title })}
              warning={t(kind.texts.warning)}
              action={kind.path}
              token={token}
              csrfToken={c.get("csrfToken")()}
            />,
            { title: t(kind.texts.heading), head: <SecretLinkHead t={t} /> },
          );
      }
    });

    app.post(kind.path, async (c) => {
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
      return c.redirect(kind.target(result.id), 303);
    });
  }
}
