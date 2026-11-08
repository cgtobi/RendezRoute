import type { Child } from "hono/jsx";
import type { Config } from "../../../config.ts";
import {
  LANGUAGE_NAMES,
  type Language,
  SUPPORTED_LANGUAGES,
  type Translate,
} from "../../i18n/i18n.ts";
import { CSRF_FIELD } from "./csrf.ts";
import { RETURN_FIELD } from "./routes/preferences.ts";
import { type Units, UNITS } from "../../../domain/units.ts";

const SOFTWARE_NAME = "RendezRoute";

interface LayoutProps {
  config: Config;
  language: Language;
  t: Translate;
  title?: string | undefined;
  /** Extra head elements, e.g. robots or Open Graph tags. */
  head?: Child | undefined;
  units: Units;
  /** The footer language and units forms; left out of pages that cannot be loaded again (decision D15). */
  languageSwitch?: { csrfToken: string; returnTo: string } | undefined;
  children?: Child;
}

export function Layout({
  config,
  language,
  t,
  title,
  head,
  units,
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
        <script src="/static/build/app.js" defer></script>
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
            <>
              <PreferenceForm
                t={t}
                {...languageSwitch}
                action="/language"
                field="language"
                label={t("layout.language")}
                options={SUPPORTED_LANGUAGES.map((value) => ({
                  value,
                  label: LANGUAGE_NAMES[value],
                  lang: value,
                }))}
                selected={language}
              />
              <PreferenceForm
                t={t}
                {...languageSwitch}
                action="/units"
                field="units"
                label={t("layout.units")}
                options={UNITS.map((value) => ({ value, label: t(`units.${value}`) }))}
                selected={units}
              />
            </>
          )}
          {config.instanceName !== SOFTWARE_NAME && (
            <p>{t("layout.poweredBy", { name: SOFTWARE_NAME })}</p>
          )}
        </footer>
      </body>
    </html>
  );
}

/** Works without JavaScript: choose and submit (decisions P5, D15). */
function PreferenceForm(props: {
  t: Translate;
  csrfToken: string;
  returnTo: string;
  action: string;
  field: string;
  label: string;
  options: readonly { value: string; label: string; lang?: string }[];
  selected: string;
}) {
  const id = `preference-${props.field}`;
  return (
    <form method="post" action={props.action} class="preference">
      <input type="hidden" name={CSRF_FIELD} value={props.csrfToken} />
      <input type="hidden" name={RETURN_FIELD} value={props.returnTo} />
      <label for={id}>{props.label}</label>
      <select id={id} name={props.field}>
        {props.options.map((option) => (
          <option
            value={option.value}
            lang={option.lang}
            selected={option.value === props.selected}
          >
            {option.label}
          </option>
        ))}
      </select>
      <button type="submit" class="secondary">
        {props.t("layout.change")}
      </button>
    </form>
  );
}
