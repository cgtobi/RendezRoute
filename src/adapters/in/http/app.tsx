import { type Context, Hono } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import type { Config } from "../../../config.ts";
import { type Language, negotiateLanguage, type Translate, translator } from "../../i18n/i18n.ts";
import type { Logger } from "../../logging.ts";
import { clientIp } from "./client-ip.ts";
import { csrf } from "./csrf.ts";
import { Layout } from "./layout.tsx";
import { requestLogger } from "./request-logger.ts";
import { securityHeaders } from "./security-headers.ts";

declare module "hono" {
  interface ContextRenderer {
    (
      content: string | Promise<string>,
      props?: { title?: string | undefined },
    ): Response | Promise<Response>;
  }
}

export interface AppDeps {
  config: Config;
  /** Derived from the encryption key (deriveKey(keyring, "csrf")). */
  csrfKey: Buffer;
  logger: Logger;
}

/** Hono context variables set by the app middleware. */
type AppEnv = {
  Variables: { language: Language; t: Translate; csrfToken: () => string; clientIp: string };
};

export function createApp({ config, csrfKey, logger }: AppDeps): Hono<AppEnv> {
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

  app.use(csrf({ key: csrfKey, config, onReject: (c) => c.text(translate(c)("error.csrf"), 403) }));

  app.use(
    jsxRenderer(
      ({ children, title }, c: Context<AppEnv>) => (
        <Layout config={config} language={c.get("language")} t={c.get("t")} title={title}>
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

  app.get("/", (c) => {
    const t = c.get("t");
    return c.render(<p>{t("home.status", { name: config.instanceName })}</p>);
  });

  return app;
}
