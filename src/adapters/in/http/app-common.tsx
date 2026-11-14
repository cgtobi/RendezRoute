// The middleware stack both listeners share (decision D55): the public app and the admin-only app
// are composed from this one helper, so the two cannot drift apart. What differs is passed in:
// the CSRF instance (its own key, cookie and origin rule on the admin listener), the upload
// routes and anything that must come before CSRF (ActivityPub).
import type { Context, Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { bodyLimit } from "hono/body-limit";
import { jsxRenderer } from "hono/jsx-renderer";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../../../config.ts";
import { isUnits } from "../../../domain/units.ts";
import { type Language, resolveLanguage, type Translate, translator } from "../../i18n/i18n.ts";
import type { Logger } from "../../logging.ts";
import type { AppEnv } from "./app.tsx";
import { clientIp } from "./client-ip.ts";
import { csrf, type CsrfOptions } from "./csrf.ts";
import { ingressCsrfGuard, type IngressCsrfOptions } from "./ingress-guard.ts";
import { Layout } from "./layout.tsx";
import { readPreference } from "./preference-cookies.ts";
import { requestLogger } from "./request-logger.ts";
import { messagePage } from "./routes/shared.tsx";
import { isSecretLinkPath } from "./routes/secret-links.tsx";
import { securityHeaders } from "./security-headers.ts";

/** Bundled assets, relative to the working directory as serveStatic expects (same from src/ and dist/). */
export const STATIC_ROOT = relative(
  process.cwd(),
  fileURLToPath(new URL("../../../../public", import.meta.url)),
);

/** Form posts; generous for the largest text fields (note: 2,000 characters). */
const MAX_BODY_BYTES = 100 * 1024;
/** GPX uploads: the 5 MB file limit plus the form fields and multipart overhead. */
const MAX_UPLOAD_BODY_BYTES = 5.5 * 1024 * 1024;

export interface CommonStackOptions {
  config: Config;
  logger: Logger;
  /**
   * The app's CSRF settings; each listener has its own key (and on the admin listener cookie and
   * origin rule). `{ ingressToken }`: the stateless token bound to the Supervisor's user, no cookie
   * (Ingress, D56 and I74).
   */
  csrf: Omit<CsrfOptions, "config" | "onReject"> | { ingressToken: IngressCsrfOptions };
  /** Who may frame the pages; 'self' for the admin listener behind Ingress (decision D56). */
  frameAncestors?: "'none'" | "'self'";
  /** Posts that may be larger than a form (the public app's GPX uploads). */
  isUploadRoute?: (method: string, path: string) => boolean;
  /** Registered after the body limit and before CSRF (ActivityPub on the public app). */
  beforeCsrf?: (app: Hono<AppEnv>) => void;
  /** The admin-only app: its pages leave out the public footer links (see Layout). */
  adminListener?: boolean;
  /**
   * Pages outside /admin/ (refusals, not-found, errors) link relative to the request path, as the
   * listener sits behind a path prefix (Ingress, D56).
   */
  relativeLinks?: boolean;
  /** Pages at these paths also answer other media types, so caches keep them apart by Accept. */
  variesByAccept?: (path: string) => boolean;
}

/**
 * Logger, security headers, client IP, language and units, page layout, body limits, CSRF, the
 * error and not-found pages, /healthz and the static assets. Returns the translator for requests
 * that fail before the language middleware ran.
 */
export function composeCommonStack(
  app: Hono<AppEnv>,
  {
    config,
    logger,
    csrf: csrfOptions,
    frameAncestors,
    isUploadRoute,
    beforeCsrf,
    variesByAccept,
    adminListener = false,
    relativeLinks = false,
  }: CommonStackOptions,
): { translate: (c: Context) => Translate } {
  /** The language cookie, else the browser's languages (decision D15). */
  const requestLanguage = (c: Context): Language =>
    resolveLanguage({
      cookie: readPreference(c, config, "lang"),
      acceptLanguage: c.req.header("accept-language"),
    });
  /** Works even before the language middleware ran, e.g. for early errors. */
  const translate = (c: Context): Translate => translator(requestLanguage(c));

  app.use(requestLogger(logger));
  app.use(securityHeaders(config, frameAncestors));
  app.use(clientIp({ trustProxy: config.trustProxy }));

  app.use(async (c, next) => {
    const language = requestLanguage(c);
    c.set("language", language);
    c.set("t", translator(language));
    const units = readPreference(c, config, "units");
    c.set("units", isUnits(units) ? units : "metric");
    c.set("relativeLinks", relativeLinks);
    await next();
    // Pages and plain-text errors are in the request's language; images, scripts and feeds are not.
    if (/^text\/(html|plain)/.test(c.res.headers.get("content-type") ?? "")) {
      c.res.headers.set("content-language", language);
      c.res.headers.append("vary", "Accept-Language, Cookie");
      // A plan's address also answers ActivityPub clients: caches keep the two apart.
      if (variesByAccept?.(c.req.path) === true) {
        c.res.headers.append("vary", "Accept");
      }
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
            c.req.method === "GET" && pathBase === undefined && plain !== true && !adminListener
              ? { csrfToken: c.get("csrfToken")(), returnTo: returnTo ?? localPath(c.req.url) }
              : undefined
          }
          pathBase={pathBase}
          adminListener={adminListener}
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
    isUploadRoute?.(c.req.method, c.req.path) === true ? uploadLimit(c, next) : formLimit(c, next),
  );

  beforeCsrf?.(app);

  if ("ingressToken" in csrfOptions) app.use(ingressCsrfGuard(csrfOptions.ingressToken));
  else {
    app.use(
      csrf({
        ...csrfOptions,
        config,
        onReject: (c) => messagePage(c, 403, translate(c)("error.csrf")),
      }),
    );
  }

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

  return { translate };
}

/** Path and query of a request URL, for returning to the same page; never a secret link (spec 3.2). */
const localPath = (url: string) => {
  const { pathname, search } = new URL(url);
  return isSecretLinkPath(pathname) ? "/" : pathname + search;
};
