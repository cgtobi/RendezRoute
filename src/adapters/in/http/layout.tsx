import type { Child } from "hono/jsx";
import { type Config, loginConfigured } from "../../../config.ts";
import {
  LANGUAGE_NAMES,
  type Language,
  SUPPORTED_LANGUAGES,
  type Translate,
} from "../../i18n/i18n.ts";
import { CSRF_FIELD } from "./csrf.ts";
import { RETURN_FIELD } from "./routes/preferences.ts";
import { type Theme, THEMES } from "../../../domain/theme.ts";
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
  /** The chosen theme; "system" renders no attribute (decision D64). */
  theme: Theme;
  /** The language, units and theme forms in the menu sheet; left out of pages that cannot be loaded again (decision D15). */
  languageSwitch?: { csrfToken: string; returnTo: string } | undefined;
  /**
   * Prefix for the app's own links: "/" on public pages; relative ("../") on instance admin pages,
   * which must work under any path prefix (spec 3.8, Home Assistant Ingress later).
   */
  pathBase?: string | undefined;
  /**
   * The page belongs to the admin-only listener (decision D55): no public footer links, no
   * language form, and the logo leads to the admin home.
   */
  adminListener?: boolean | undefined;
  /** A page that uses the full width on large screens (the plan page's two columns). */
  wide?: boolean | undefined;
  children?: Child;
}

export function Layout({
  config,
  language,
  t,
  title,
  head,
  units,
  theme,
  languageSwitch,
  pathBase = "/",
  adminListener = false,
  wide = false,
  children,
}: LayoutProps) {
  /** Adds the full-width class on wide pages. */
  const widened = (base?: string) => (wide ? [base, "wide"].filter(Boolean).join(" ") : base);
  const pageTitle = title === undefined ? config.instanceName : `${title} · ${config.instanceName}`;
  return (
    <html lang={language} data-theme={theme === "system" ? undefined : theme}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{pageTitle}</title>
        {/* The PNG for browsers without SVG tab icons; the others prefer the SVG (decision D28). */}
        <link
          rel="icon"
          href={`${pathBase}static/brand/tab-icon-32.png`}
          sizes="32x32"
          type="image/png"
        />
        <link rel="icon" href={`${pathBase}static/brand/tab-icon.svg`} type="image/svg+xml" />
        <link rel="apple-touch-icon" href={`${pathBase}static/brand/apple-touch-icon.png`} />
        <link rel="stylesheet" href={`${pathBase}static/build/fonts.css`} />
        <link rel="stylesheet" href={`${pathBase}static/app.css`} />
        <script src={`${pathBase}static/build/app.js`} defer></script>
        {head}
      </head>
      <body>
        {config.allowInsecureDev && (
          <p class="dev-banner" role="alert">
            {t("layout.devBanner")}
          </p>
        )}
        <header class={widened(adminListener ? "site-header" : "site-header site-header-menu")}>
          <a href={adminListener ? `${pathBase}admin/` : pathBase}>
            <span class="logo" aria-hidden="true"></span>
            {config.instanceName}
          </a>
          {/* A sheet that works without JavaScript: the popover attribute (decisions D27, D68). */}
          {!adminListener && (
            <>
              <button
                type="button"
                class="burger"
                popovertarget="site-menu"
                aria-label={t("layout.menu")}
              ></button>
              <div id="site-menu" popover="auto">
                <div class="site-menu-body">
                  <nav class="site-menu-links" aria-label={t("layout.menu")}>
                    <ul>
                      {config.nearbyEnabled && (
                        <li>
                          <a href={`${pathBase}nearby`}>{t("layout.nearby")}</a>
                        </li>
                      )}
                      <li>
                        <a href={`${pathBase}my-data`}>{t("layout.myData")}</a>
                      </li>
                      {loginConfigured(config) && (
                        <li>
                          <a href={`${pathBase}account`}>{t("layout.account")}</a>
                        </li>
                      )}
                    </ul>
                  </nav>
                  <div class="site-menu-preferences">
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
                        <PreferenceForm
                          t={t}
                          {...languageSwitch}
                          action="/theme"
                          field="theme"
                          label={t("layout.theme")}
                          options={THEMES.map((value) => ({ value, label: t(`theme.${value}`) }))}
                          selected={theme}
                        />
                      </>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </header>
        <main class={widened()}>{children}</main>
        <footer class={widened("site-footer")}>
          {config.instanceName !== SOFTWARE_NAME && (
            <p class="powered-by">{t("layout.poweredBy", { name: SOFTWARE_NAME })}</p>
          )}
          {/* Legal notices stay visible (German law asks for an imprint that is easy to find). */}
          {(config.privacyUrl !== undefined ||
            !adminListener ||
            config.imprintUrl !== undefined) && (
            <p class="legal-links">
              {config.privacyUrl === undefined ? (
                !adminListener && <a href={`${pathBase}privacy`}>{t("layout.privacy")}</a>
              ) : (
                <a href={config.privacyUrl.href} rel="noopener noreferrer">
                  {t("layout.privacy")}
                </a>
              )}
              {config.imprintUrl !== undefined && (
                <a href={config.imprintUrl.href} rel="noopener noreferrer">
                  {t("layout.imprint")}
                </a>
              )}
            </p>
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
      <select id={id} name={props.field} data-auto-submit>
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
