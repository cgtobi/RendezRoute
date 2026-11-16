import type { Federation } from "@fedify/fedify";
import { federation as federationMiddleware } from "@fedify/hono";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import type { Child } from "hono/jsx";
import type { AccountDeps } from "../../../application/accounts.ts";
import { routeForNoteLink } from "../../../application/participant-notes.ts";
import type { PlanDeps } from "../../../application/plans.ts";
import { listTemplates } from "../../../application/templates.ts";
import type {
  AdminAuth,
  Geocoder,
  PreviewRenderer,
  WeatherProvider,
} from "../../../application/ports.ts";
import type { Config } from "../../../config.ts";
import type { Theme } from "../../../domain/theme.ts";
import type { Units } from "../../../domain/units.ts";
import type { Language, Translate } from "../../i18n/i18n.ts";
import type { Logger } from "../../logging.ts";
import { toGpx } from "../../out/gpx/write-gpx.ts";
import { composeCommonStack, STATIC_ROOT } from "./app-common.tsx";
import { readDeviceToken } from "./device-cookie.ts";
import { clientKey, type RateLimits } from "./rate-limit.ts";
import { registerCalendarRoutes } from "./routes/calendar.tsx";
import { registerHostRoutes } from "./routes/host.tsx";
import { registerNotificationRoutes } from "./routes/notifications.ts";
import { registerPreferenceRoutes } from "./routes/preferences.ts";
import { registerPlaceRoutes } from "./routes/places.ts";
import { registerProfileRoutes } from "./routes/fediverse-profile.tsx";
import { registerNearbyRoutes } from "./routes/nearby.tsx";
import { registerPlanRoutes } from "./routes/plans.tsx";
import { registerRecapRoutes } from "./routes/recap.tsx";
import { registerTemplateRoutes } from "./routes/templates.tsx";
import { registerLinkToolRoutes } from "./routes/link-tools.tsx";
import { registerMyDataRoutes } from "./routes/my-data.tsx";
import { registerRatingRoutes } from "./routes/ratings.tsx";
import { registerAdminRoutes } from "./routes/admin.tsx";
import { registerReportRoutes } from "./routes/reports.tsx";
import { registerResponseRoutes } from "./routes/responses.tsx";
import { registerAccountRoutes } from "./routes/account.tsx";
import type { LoginOption } from "./views/account.tsx";
import { registerInviteRoutes } from "./routes/invites.tsx";
import { registerSecretLinkRoutes } from "./routes/secret-links.tsx";
import { CHANNEL_LINK_PATH, registerChannelLinkRoutes } from "./routes/channel-links.tsx";
import { PrivacyPage } from "./views/privacy-page.tsx";
import { TemplateList } from "./views/templates.tsx";

const isUploadRoute = (method: string, path: string) =>
  method === "POST" && (path === "/new" || /^\/p\/[^/]+\/host\/route$/.test(path));

declare module "hono" {
  interface ContextRenderer {
    (
      content: string | Promise<string>,
      props?: {
        title?: string | undefined;
        head?: Child | undefined;
        /** Relative prefix for instance admin pages (spec 3.8 URLs). */
        pathBase?: string | undefined;
        /** The page uses the full width on large screens (Layout). */
        wide?: boolean | undefined;
        /**
         * A page that only says what happened (decision D29): without the language and units
         * forms, whose token would set a cookie on every unknown address.
         */
        plain?: boolean | undefined;
        /**
         * Where the language and units forms return to, instead of the request's own address:
         * Nearby passes its query with the viewer's place rounded (decision D35).
         */
        returnTo?: string | undefined;
      },
    ): Response | Promise<Response>;
  }
}

/** The shared inbox and each actor's own (plan v1.0 step 9a). */
const INBOX_PATH = /^\/(?:inbox|actors\/[^/]+\/inbox)$/;
/** A plan's page, which ActivityPub clients get as an Event (spec 7). */
const PLAN_PAGE = /^\/p\/[A-Za-z0-9_-]+$/;

export interface AppDeps {
  config: Config;
  /** Derived from the encryption key (deriveKey(keyring, "csrf")). */
  csrfKey: Buffer;
  logger: Logger;
  planDeps: PlanDeps;
  /** Place search; undefined when the geocoder is disabled (spec 3.9). */
  geocoder: Geocoder | undefined;
  /** Open Graph card images (spec 3.3). */
  previewRenderer: PreviewRenderer;
  /** Forecasts on plan pages; undefined when weather is disabled (spec 3.9). */
  weather: WeatherProvider | undefined;
  /** Shared with the scheduler, which sweeps them every minute (decision I33). */
  rateLimits: RateLimits;
  /** Given to browsers as the applicationServerKey for Web Push (spec 6 feature 3). */
  vapidPublicKey: string;
  /** The instance admin's authentication; undefined when none is configured (spec 7). */
  adminAuth?: AdminAuth | undefined;
  /** Accounts and the configured ways to log in (spec 7 Identity). */
  accounts?: AccountWiring | undefined;
  /** The instance in the fediverse; undefined while FEDERATION_ENABLED is false (step 9a). */
  federation?: Federation<void> | undefined;
}

export type AccountWiring = Omit<AccountDeps, keyof PlanDeps>;

/** Hono context variables set by the app middleware. */
export type AppEnv = {
  Variables: {
    language: Language;
    t: Translate;
    units: Units;
    theme: Theme;
    csrfToken: () => string;
    clientIp: string;
    /** Pages outside /admin/ link relative to the request path (Ingress admin listener). */
    relativeLinks: boolean;
  };
};

export function createApp({
  config,
  csrfKey,
  logger,
  planDeps,
  geocoder,
  previewRenderer,
  weather,
  rateLimits,
  vapidPublicKey,
  adminAuth,
  accounts,
  federation,
}: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  composeCommonStack(app, {
    config,
    logger,
    isUploadRoute,
    // A plan's address also answers ActivityPub clients: caches keep the two apart.
    variesByAccept: (path) => federation !== undefined && PLAN_PAGE.test(path),
    // ActivityPub (spec 7): after the body limit, which bounds inbox posts too, and before CSRF,
    // since remote servers sign their posts instead of sending a form token. Anything not for
    // ActivityPub clients (the plan page in a browser) passes on to the routes below.
    beforeCsrf: (stack) => {
      if (federation === undefined) return;
      // Inbox posts are rate limited per client (spec 3.11): each may make the instance fetch the
      // sender's key.
      stack.use(async (c, next) => {
        if (c.req.method === "POST" && INBOX_PATH.test(c.req.path)) {
          const allowed = rateLimits.inbox.take(clientKey(c.get("clientIp")));
          if (!allowed.ok) {
            c.header("retry-after", String(allowed.retryAfterSeconds));
            return c.text("Too many requests", 429);
          }
        }
        return next();
      });
      stack.use(federationMiddleware(federation, () => undefined));
    },
    csrf: {
      key: csrfKey,
      exempt: (method, path) => method === "POST" && CHANNEL_LINK_PATH.test(path),
    },
  });

  // The GPX of a private Note to a remote participant (decision D43): public by its secret token,
  // so every try is counted, and every failure (unknown, withdrawn, no route, federation off) is
  // the same plain 404. Before the page routes, which have no use for it.
  app.get("/federation/notes/:token/route.gpx", async (c) => {
    const notFound = () => c.text("Not found", 404);
    const allowed = rateLimits.noteRoute.take(clientKey(c.get("clientIp")));
    if (!allowed.ok) {
      c.header("retry-after", String(allowed.retryAfterSeconds));
      return c.text("Too many requests", 429);
    }
    const found = await routeForNoteLink(planDeps, c.req.param("token"));
    if (found.kind === "not_found") return notFound();
    c.header("content-type", "application/gpx+xml; charset=utf-8");
    c.header("content-disposition", 'attachment; filename="route.gpx"');
    c.header("cache-control", "no-store");
    c.header("x-robots-tag", "noindex, nofollow");
    c.header("referrer-policy", "no-referrer");
    return c.body(toGpx(found.route, found.title));
  });

  app.get("/", async (c) => {
    const t = c.get("t");
    // The device's templates (spec 3.10, decision I43), so the page is private when it has any.
    const templates = await listTemplates(planDeps, {
      deviceToken: readDeviceToken(c, config),
    });
    if (templates.length > 0) c.header("cache-control", "private, no-store");
    return c.render(
      <section class="home">
        {c.req.query("dataDeleted") !== undefined && (
          <p class="notice" role="status">
            {t("myData.deleted")}
          </p>
        )}
        <p>{t("home.intro")}</p>
        <p>
          <a class="button" href="/new">
            {t("home.cta")}
          </a>
        </p>
        {config.nearbyEnabled && (
          <p>
            <a href="/nearby">{t("home.nearby")}</a>
          </p>
        )}
        <TemplateList t={t} templates={templates} />
      </section>,
    );
  });

  app.get("/privacy", (c) => {
    if (config.privacyUrl !== undefined) return c.redirect(config.privacyUrl.href, 302);
    const t = c.get("t");
    return c.render(
      <PrivacyPage
        t={t}
        config={config}
        adminLogin={adminAuth !== undefined}
        adminCookie={adminAuth !== undefined && config.admin?.ingress === undefined}
      />,
      {
        title: t("privacy.title"),
      },
    );
  });

  /** The service worker must come from the site root to show this site's notifications (spec 6 feature 3). */
  let serviceWorker: string | undefined;
  app.get("/sw.js", async (c) => {
    // Read once; a missing build is looked for again on the next request.
    serviceWorker ??= await readFile(join(STATIC_ROOT, "build", "sw.js"), "utf8").catch(
      () => undefined,
    );
    const script = serviceWorker;
    if (script === undefined) return c.notFound();
    c.header("content-type", "text/javascript; charset=utf-8");
    c.header("cache-control", "no-cache");
    return c.body(script);
  });

  // The configured ways to log in that have a provider (spec 7 Identity).
  const logins: LoginOption[] = [
    ...(config.oidc !== undefined && accounts?.identityProviders.oidc !== undefined
      ? [{ provider: "oidc" as const, name: config.oidc.name }]
      : []),
    ...(config.fediverseLogin !== undefined && accounts?.identityProviders.fediverse !== undefined
      ? [{ provider: "fediverse" as const, servers: config.fediverseLogin.servers }]
      : []),
  ];
  const accountDeps =
    accounts === undefined || logins.length === 0 ? undefined : { ...planDeps, ...accounts };
  const deps = {
    config,
    planDeps,
    accounts: accountDeps,
    geocoder,
    previewRenderer,
    weather,
    limits: rateLimits,
    vapidPublicKey,
    reporting: adminAuth !== undefined,
  };
  registerPlanRoutes(app, deps);
  // Profiles exist only for accounts, while federation is on (decisions D36, D37).
  if (federation !== undefined && accounts !== undefined) {
    registerProfileRoutes(app, { config, planDeps, identities: accounts.identities });
  }
  // Off: no page, no link, no query (spec 7 Visibility and Nearby plans).
  if (config.nearbyEnabled) registerNearbyRoutes(app, deps);
  registerResponseRoutes(app, deps);
  registerSecretLinkRoutes(app, deps);
  // Also without SMTP or ntfy: links sent before either was switched off still turn them off.
  if (planDeps.notify?.links !== undefined) registerChannelLinkRoutes(app, deps);
  registerHostRoutes(app, deps);
  if (geocoder !== undefined) registerPlaceRoutes(app, { geocoder, limits: rateLimits });
  registerPreferenceRoutes(app, { config });
  registerNotificationRoutes(app, { config, planDeps, limits: rateLimits });
  registerCalendarRoutes(app, deps);
  registerRecapRoutes(app, deps);
  registerTemplateRoutes(app, deps);
  registerLinkToolRoutes(app, deps);
  registerMyDataRoutes(app, deps);
  registerRatingRoutes(app, deps);
  if (accountDeps !== undefined) {
    registerAccountRoutes(app, deps, { deps: accountDeps, logins });
  }
  if (config.postingMode === "invite") registerInviteRoutes(app, deps);
  if (adminAuth !== undefined) {
    registerReportRoutes(app, deps);
    // With ADMIN_PORT the admin pages are on the admin listener only; here /admin is any other
    // unknown path (decision D55).
    if (config.admin === undefined) {
      registerAdminRoutes(app, {
        config,
        adminDeps: { ...planDeps, adminAuth },
        limits: rateLimits,
      });
    }
  }

  return app;
}
