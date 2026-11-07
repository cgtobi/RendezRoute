import { type Context, Hono } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import type { Config } from "../../../config.ts";
import { type Language, negotiateLanguage, type Translate, translator } from "../../i18n/i18n.ts";
import { Layout } from "./layout.tsx";

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
}

type Env = { Variables: { language: Language; t: Translate } };

export function createApp({ config }: AppDeps): Hono<Env> {
  const app = new Hono<Env>();

  app.use(async (c, next) => {
    const language = negotiateLanguage(c.req.header("accept-language"));
    c.set("language", language);
    c.set("t", translator(language));
    await next();
  });

  app.use(
    jsxRenderer(
      ({ children, title }, c: Context<Env>) => (
        <Layout config={config} language={c.get("language")} t={c.get("t")} title={title}>
          {children}
        </Layout>
      ),
      { docType: true },
    ),
  );

  app.get("/healthz", (c) => c.text("ok"));

  app.get("/", (c) => {
    const t = c.get("t");
    return c.render(<p>{t("home.status", { name: config.instanceName })}</p>);
  });

  return app;
}
