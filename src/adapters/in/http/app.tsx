import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { type Context, Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { bodyLimit } from "hono/body-limit";
import type { Child } from "hono/jsx";
import { jsxRenderer } from "hono/jsx-renderer";
import type { PlanDeps } from "../../../application/plans.ts";
import type { Geocoder } from "../../../application/ports.ts";
import type { Config } from "../../../config.ts";
import { type Language, negotiateLanguage, type Translate, translator } from "../../i18n/i18n.ts";
import type { Logger } from "../../logging.ts";
import { clientIp } from "./client-ip.ts";
import { csrf } from "./csrf.ts";
import { registerHostRoutes } from "./routes/host.tsx";
import { registerPlaceRoutes } from "./routes/places.ts";
import { registerPlanRoutes } from "./routes/plans.tsx";
import { registerResponseRoutes } from "./routes/responses.tsx";
import { registerSecretLinkRoutes } from "./routes/secret-links.tsx";
import { Layout } from "./layout.tsx";
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
}

/** Hono context variables set by the app middleware. */
export type AppEnv = {
  Variables: { language: Language; t: Translate; csrfToken: () => string; clientIp: string };
};

export function createApp({ config, csrfKey, logger, planDeps, geocoder }: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** Works even before the language middleware ran, e.g. for early errors. */
  const translate = (c: Context): Translate =>
    translator(negotiateLanguage(c.req.header("accept-language")));

  app.use(requestLogger(logger));
  app.use(securityHeaders(config));
  app.use(clientIp({ trustProxy: config.trustProxy }));

  app.use(async (c, next) => {
    const language = negotiateLanguage(c.req.header("accept-language"));
    c.set("language", language);
    c.set("t", translator(language));
    await next();
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

  const deps = { config, planDeps, geocoder };
  registerPlanRoutes(app, deps);
  registerResponseRoutes(app, deps);
  registerSecretLinkRoutes(app, deps);
  registerHostRoutes(app, deps);
  if (geocoder !== undefined) registerPlaceRoutes(app, { geocoder });

  return app;
}
