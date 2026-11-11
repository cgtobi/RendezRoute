import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { type Context, Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { bodyLimit } from "hono/body-limit";
import type { Child } from "hono/jsx";
import { jsxRenderer } from "hono/jsx-renderer";
import type { AccountDeps } from "../../../application/accounts.ts";
import type { PlanDeps } from "../../../application/plans.ts";
import { listTemplates } from "../../../application/templates.ts";
import type {
  AdminAuth,
  Geocoder,
  PreviewRenderer,
  WeatherProvider,
} from "../../../application/ports.ts";
import type { Config } from "../../../config.ts";
import { isUnits, type Units } from "../../../domain/units.ts";
import { type Language, resolveLanguage, type Translate, translator } from "../../i18n/i18n.ts";
import type { Logger } from "../../logging.ts";
import { clientIp } from "./client-ip.ts";
import { csrf } from "./csrf.ts";
import { readDeviceToken } from "./device-cookie.ts";
import { readPreference } from "./preference-cookies.ts";
import type { RateLimits } from "./rate-limit.ts";
import { registerCalendarRoutes } from "./routes/calendar.tsx";
import { registerHostRoutes } from "./routes/host.tsx";
import { registerNotificationRoutes } from "./routes/notifications.ts";
import { registerPreferenceRoutes } from "./routes/preferences.ts";
import { registerPlaceRoutes } from "./routes/places.ts";
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
import { isSecretLinkPath, registerSecretLinkRoutes } from "./routes/secret-links.tsx";
import { CHANNEL_LINK_PATH, registerChannelLinkRoutes } from "./routes/channel-links.tsx";
import { Layout } from "./layout.tsx";
import { PrivacyPage } from "./views/privacy-page.tsx";
import { TemplateList } from "./views/templates.tsx";
import { messagePage } from "./routes/shared.tsx";
import { requestLogger } from "./request-logger.ts";
import { securityHeaders } from "./security-headers.ts";

/** Bundled assets, relative to the working directory as serveStatic expects (same from src/ and dist/). */
const STATIC_ROOT = relative(
  process.cwd(),
  fileURLToPath(new URL("../../../../public", import.meta.url)),
);

/** Form posts; generous for the largest text fields (note: 2,000 characters). */
const MAX_BODY_BYTES = 100 * 1024;
/** GPX uploads: the 5 MB file limit plus the form fields and multipart overhead. */
const MAX_UPLOAD_BODY_BYTES = 5.5 * 1024 * 1024;
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
}

export type AccountWiring = Omit<AccountDeps, keyof PlanDeps>;

/** Hono context variables set by the app middleware. */
export type AppEnv = {
  Variables: {
    language: Language;
    t: Translate;
    units: Units;
    csrfToken: () => string;
    clientIp: string;
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
}: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** The language cookie, else the browser's languages (decision D15). */
  const requestLanguage = (c: Context): Language =>
    resolveLanguage({
      cookie: readPreference(c, config, "lang"),
      acceptLanguage: c.req.header("accept-language"),
    });
  /** Works even before the language middleware ran, e.g. for early errors. */
  const translate = (c: Context): Translate => translator(requestLanguage(c));

  app.use(requestLogger(logger));
  app.use(securityHeaders(config));
  app.use(clientIp({ trustProxy: config.trustProxy }));

  app.use(async (c, next) => {
    const language = requestLanguage(c);
    c.set("language", language);
    c.set("t", translator(language));
    const units = readPreference(c, config, "units");
    c.set("units", isUnits(units) ? units : "metric");
    await next();
    // Pages and plain-text errors are in the request's language; images, scripts and feeds are not.
    if (/^text\/(html|plain)/.test(c.res.headers.get("content-type") ?? "")) {
      c.res.headers.set("content-language", language);
      c.res.headers.append("vary", "Accept-Language, Cookie");
    }
  });

  // Before the body limit and CSRF, so that their answers are pages of the site too (decision D29).
  app.use(
    jsxRenderer(
      ({ children, title, head, pathBase, wide, plain, returnTo }, c: Context<AppEnv>) => (
        <Layout
          config={config}
          language={c.get("language")}
          t={c.get("t")}
          title={title}
          head={head}
          units={c.get("units")}
          languageSwitch={
            // Pages answering a form post (e.g. links shown once) cannot be loaded again; admin
            // pages keep only relative links, and the switch posts to absolute paths.
            c.req.method === "GET" && pathBase === undefined && plain !== true
              ? { csrfToken: c.get("csrfToken")(), returnTo: returnTo ?? localPath(c.req.url) }
              : undefined
          }
          pathBase={pathBase}
          wide={wide}
        >
          {children}
        </Layout>
      ),
      { docType: true },
    ),
  );

  // Before CSRF, which parses form bodies. Only the GPX upload routes accept more (spec 3.8).
  const tooLarge = (c: Context) => messagePage(c, 413, translate(c)("error.tooLarge"));
  const formLimit = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge });
  const uploadLimit = bodyLimit({ maxSize: MAX_UPLOAD_BODY_BYTES, onError: tooLarge });
  app.use((c, next) =>
    isUploadRoute(c.req.method, c.req.path) ? uploadLimit(c, next) : formLimit(c, next),
  );

  app.use(
    csrf({
      key: csrfKey,
      config,
      exempt: (method, path) => method === "POST" && CHANNEL_LINK_PATH.test(path),
      onReject: (c) => messagePage(c, 403, translate(c)("error.csrf")),
    }),
  );

  app.onError(async (error, c) => {
    // Error class only: messages may contain user input.
    logger.error("unhandled_error", { name: error.name });
    const message = translate(c)("error.internal");
    try {
      return await messagePage(c, 500, message);
    } catch {
      // The page itself failed: the message alone.
      return c.text(message, 500);
    }
  });

  app.notFound((c) => messagePage(c, 404, translate(c)("error.notFound")));

  app.get("/healthz", (c) => c.text("ok"));

  app.use(
    "/static/*",
    async (c, next) => {
      await next();
      if (c.res.ok) c.res.headers.set("cache-control", "public, max-age=3600");
    },
    serveStatic({ root: STATIC_ROOT, rewriteRequestPath: (path) => path.replace(/^\/static/, "") }),
  );

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
    return c.render(<PrivacyPage t={t} config={config} adminLogin={adminAuth !== undefined} />, {
      title: t("privacy.title"),
    });
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
    registerAdminRoutes(app, { config, adminDeps: { ...planDeps, adminAuth }, limits: rateLimits });
  }

  return app;
}

/** Path and query of a request URL, for returning to the same page; never a secret link (spec 3.2). */
const localPath = (url: string) => {
  const { pathname, search } = new URL(url);
  return isSecretLinkPath(pathname) ? "/" : pathname + search;
};
