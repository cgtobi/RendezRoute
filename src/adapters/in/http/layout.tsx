import type { Child } from "hono/jsx";
import type { Config } from "../../../config.ts";
import {
  LANGUAGE_NAMES,
  type Language,
  SUPPORTED_LANGUAGES,
  type Translate,
} from "../../i18n/i18n.ts";
import { CSRF_FIELD } from "./csrf.ts";
import { RETURN_FIELD } from "./routes/language.ts";

const SOFTWARE_NAME = "RendezRoute";

interface LayoutProps {
  config: Config;
  language: Language;
  t: Translate;
  title?: string | undefined;
  /** Extra head elements, e.g. robots or Open Graph tags. */
  head?: Child | undefined;
  /** The footer language form; left out of pages that cannot be loaded again (decision D15). */
  languageSwitch?: { csrfToken: string; returnTo: string } | undefined;
  children?: Child;
}

export function Layout({
  config,
  language,
  t,
  title,
  head,
  languageSwitch,
  children,
}: LayoutProps) {
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
          {languageSwitch !== undefined && (
            <LanguageSwitch t={t} language={language} {...languageSwitch} />
          )}
          {config.instanceName !== SOFTWARE_NAME && (
            <p>{t("layout.poweredBy", { name: SOFTWARE_NAME })}</p>
          )}
        </footer>
      </body>
    </html>
  );
}

/** Works without JavaScript: choose and submit; each language is named in itself. */
function LanguageSwitch(props: {
  t: Translate;
  language: Language;
  csrfToken: string;
  returnTo: string;
}) {
  return (
    <form method="post" action="/language" class="language-switch">
      <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />
      <input type="hidden" name={RETURN_FIELD} value={props.returnTo} />
      <label for="language-select">{props.t("layout.language")}</label>
      <select id="language-select" name="language">
        {SUPPORTED_LANGUAGES.map((language) => (
          <option value={language} lang={language} selected={language === props.language}>
            {LANGUAGE_NAMES[language]}
          </option>
        ))}
      </select>
      <button type="submit" class="secondary">
        {props.t("layout.languageSubmit")}
      </button>
    </form>
  );
}
