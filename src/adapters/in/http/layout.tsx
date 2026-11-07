import type { Child } from "hono/jsx";
import type { Language, Translate } from "../../i18n/i18n.ts";
import type { Config } from "../../../config.ts";

const SOFTWARE_NAME = "RendezRoute";

interface LayoutProps {
  config: Config;
  language: Language;
  t: Translate;
  title?: string | undefined;
  children?: Child;
}

export function Layout({ config, language, t, title, children }: LayoutProps) {
  const pageTitle = title === undefined ? config.instanceName : `${title} · ${config.instanceName}`;
  return (
    <html lang={language}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{pageTitle}</title>
      </head>
      <body>
        {config.allowInsecureDev && (
          <p class="dev-banner" role="alert">
            {t("layout.devBanner")}
          </p>
        )}
        <header>
          <a href="/">{config.instanceName}</a>
        </header>
        <main>{children}</main>
        <footer>
          {config.instanceName !== SOFTWARE_NAME && (
            <p>{t("layout.poweredBy", { name: SOFTWARE_NAME })}</p>
          )}
        </footer>
      </body>
    </html>
  );
}
