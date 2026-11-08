import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { type Context, Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { bodyLimit } from "hono/body-limit";
import type { Child } from "hono/jsx";
import { jsxRenderer } from "hono/jsx-renderer";
import type { PlanDeps } from "../../../application/plans.ts";
import type { Geocoder, PreviewRenderer, WeatherProvider } from "../../../application/ports.ts";
import type { Config } from "../../../config.ts";
import { isUnits, type Units } from "../../../domain/units.ts";
import { type Language, resolveLanguage, type Translate, translator } from "../../i18n/i18n.ts";
import type { Logger } from "../../logging.ts";
import { clientIp } from "./client-ip.ts";
import { csrf } from "./csrf.ts";
import { readPreference } from "./preference-cookies.ts";
import type { RateLimits } from "./rate-limit.ts";
import { registerCalendarRoutes } from "./routes/calendar.tsx";
import { registerHostRoutes } from "./routes/host.tsx";
import { registerNotificationRoutes } from "./routes/notifications.ts";
import { registerPreferenceRoutes } from "./routes/preferences.ts";
import { registerPlaceRoutes } from "./routes/places.ts";
import { registerPlanRoutes } from "./routes/plans.tsx";
import { registerResponseRoutes } from "./routes/responses.tsx";
import { isSecretLinkPath, registerSecretLinkRoutes } from "./routes/secret-links.tsx";
import { Layout } from "./layout.tsx";
import { PrivacyPage } from "./views/privacy-page.tsx";
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
      props?: { title?: string | undefined; head?: Child | undefined },
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
}

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

  // Before CSRF, which parses form bodies. Only the GPX upload routes accept more (spec 3.8).
  const tooLarge = (c: Context) => c.text(translate(c)("error.tooLarge"), 413);
  const formLimit = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge });
  const uploadLimit = bodyLimit({ maxSize: MAX_UPLOAD_BODY_BYTES, onError: tooLarge });
  app.use((c, next) =>
    isUploadRoute(c.req.method, c.req.path) ? uploadLimit(c, next) : formLimit(c, next),
  );

  app.use(csrf({ key: csrfKey, config, onReject: (c) => c.text(translate(c)("error.csrf"), 403) }));

  app.use(
    jsxRenderer(
      ({ children, title, head }, c: Context<AppEnv>) => (
        <Layout
          config={config}
          language={c.get("language")}
          t={c.get("t")}
          title={title}
          head={head}
          units={c.get("units")}
          languageSwitch={
            // Pages answering a form post (e.g. links shown once) cannot be loaded again.
            c.req.method === "GET"
              ? { csrfToken: c.get("csrfToken")(), returnTo: localPath(c.req.url) }
              : undefined
          }
        >
          {children}
        </Layout>
      ),
      { docType: true },
    ),
  );

  app.onError((error, c) => {
    // Error class only: messages may contain user input.
    logger.error("unhandled_error", { name: error.name });
    return c.text(translate(c)("error.internal"), 500);
  });

  app.get("/healthz", (c) => c.text("ok"));

  app.use(
    "/static/*",
    async (c, next) => {
      await next();
      if (c.res.ok) c.res.headers.set("cache-control", "public, max-age=3600");
    },
    serveStatic({ root: STATIC_ROOT, rewriteRequestPath: (path) => path.replace(/^\/static/, "") }),
  );

  app.get("/", (c) => {
    const t = c.get("t");
    return c.render(
      <section class="home">
        <p>{t("home.intro")}</p>
        <p>
          <a class="button" href="/new">
            {t("home.cta")}
          </a>
        </p>
      </section>,
    );
  });

  app.get("/privacy", (c) => {
    if (config.privacyUrl !== undefined) return c.redirect(config.privacyUrl.href, 302);
    const t = c.get("t");
    return c.render(<PrivacyPage t={t} config={config} />, { title: t("privacy.title") });
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

  const deps = {
    config,
    planDeps,
    geocoder,
    previewRenderer,
    weather,
    limits: rateLimits,
    vapidPublicKey,
  };
  registerPlanRoutes(app, deps);
  registerResponseRoutes(app, deps);
  registerSecretLinkRoutes(app, deps);
  registerHostRoutes(app, deps);
  if (geocoder !== undefined) registerPlaceRoutes(app, { geocoder, limits: rateLimits });
  registerPreferenceRoutes(app, { config });
  registerNotificationRoutes(app, { config, planDeps, limits: rateLimits });
  registerCalendarRoutes(app, deps);

  return app;
}

/** Path and query of a request URL, for returning to the same page; never a secret link (spec 3.2). */
const localPath = (url: string) => {
  const { pathname, search } = new URL(url);
  return isSecretLinkPath(pathname) ? "/" : pathname + search;
};
