import type { Child } from "hono/jsx";
import type { Config } from "../../../config.ts";
import type { Language, Translate } from "../../i18n/i18n.ts";

const SOFTWARE_NAME = "RendezRoute";

interface LayoutProps {
  config: Config;
  language: Language;
  t: Translate;
  title?: string | undefined;
  /** Extra head elements, e.g. robots or Open Graph tags. */
  head?: Child | undefined;
  children?: Child;
}

export function Layout({ config, language, t, title, head, children }: LayoutProps) {
  const pageTitle = title === undefined ? config.instanceName : `${title} · ${config.instanceName}`;
  return (
    <html lang={language}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{pageTitle}</title>
        <link rel="stylesheet" href="/static/app.css" />
        {head}
      </head>
      <body>
        {config.allowInsecureDev && (
          <p class="dev-banner" role="alert">
            {t("layout.devBanner")}
          </p>
        )}
        <header class="site-header">
          <a href="/">{config.instanceName}</a>
        </header>
        <main>{children}</main>
        <footer class="site-footer">
          {config.instanceName !== SOFTWARE_NAME && (
            <p>{t("layout.poweredBy", { name: SOFTWARE_NAME })}</p>
          )}
        </footer>
      </body>
    </html>
  );
}
