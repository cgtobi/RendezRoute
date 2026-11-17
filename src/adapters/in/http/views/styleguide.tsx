// The dev-only style guide (decision D72, plan 0.13 step 13b): the real views and the real
// stylesheet on one page, so a change to either shows up here. Registered only with
// ALLOW_INSECURE_DEV. The page's own prose is English only (a developer page is exempt from the
// three-language rule); the real components inside it use t(...) in the request language.
import type { Config } from "../../../../config.ts";
import { DEFAULT_COLORS } from "../../../../domain/color.ts";
import type { FieldError, PlanInput } from "../../../../domain/plan-input.ts";
import { PLAN_INPUT_FIELDS } from "../../../../domain/plan-input.ts";
import type { Theme } from "../../../../domain/theme.ts";
import type { Units } from "../../../../domain/units.ts";
import type { Language, Translate } from "../../../i18n/i18n.ts";
import { MenuSheetBody } from "../layout.tsx";
import { Initial, PersonName } from "./avatar.tsx";
import { ModeSwitch } from "./maps.tsx";
import { ExactStartSection } from "./plan-page.tsx";
import { Fold, PlanForm, type VisibilityChoice } from "./plan-form.tsx";
import { PlanMetrics } from "./plan-metrics.tsx";
import { ShareLinks } from "./share.tsx";
import { Status } from "./status.tsx";
import { WhenWhere, WhenWhereLines } from "./when-where.tsx";

/** The colour tokens of app.css :root; each has a swatch class `sg-swatch-<name>` in styleguide.css. */
export const THEME_TOKENS = [
  "bg",
  "fg",
  "muted",
  "line",
  "control-line",
  "field-border",
  "surface",
  "accent",
  "on-accent",
  "focus",
  "danger",
  "on-danger",
  "warning-bg",
  "warning-line",
  "ok",
  "ok-bg",
  "ok-line",
] as const;

/** Every section id, in page order. */
export const SECTION_IDS = [
  "sg-typography",
  "sg-buttons",
  "sg-inputs",
  "sg-choices",
  "sg-notices",
  "sg-folds",
  "sg-title",
  "sg-lines",
  "sg-plan-form",
  "sg-header-sheet",
  "sg-footer",
  "sg-badges",
  "sg-theme-colors",
] as const;

interface StyleGuideProps {
  t: Translate;
  config: Config;
  language: Language;
  units: Units;
  theme: Theme;
  csrfToken: string;
  returnTo: string;
}

const SAMPLE_VALUES: PlanInput = {
  ...(Object.fromEntries(PLAN_INPUT_FIELDS.map((field) => [field, ""])) as PlanInput),
  activity: "run",
  timeZone: "Europe/Berlin",
  dropPolicy: "no_drop",
  shareCopy: "1",
  shareNative: "1",
  shareWhatsApp: "1",
  primaryColor: DEFAULT_COLORS.primary,
  secondaryColor: DEFAULT_COLORS.secondary,
};

const FILLED_VALUES: PlanInput = {
  ...SAMPLE_VALUES,
  posterName: "Anna",
  title: "Easy Sunday run",
  note: "Bring water.",
  date: "2031-06-07",
  time: "07:30",
  areaLabel: "Englischer Garten, north end",
  exactDescription: "North gate, by the bike racks",
  exactLat: "48.16321",
  exactLng: "11.60147",
  distanceKm: "12.5",
  paceFrom: "5:30",
  paceTo: "6:00",
  joinMode: "open",
  visibility: "public",
};

const ERRORS: readonly FieldError[] = [
  { field: "title", code: "required" },
  { field: "date", code: "date_invalid" },
  { field: "areaLabel", code: "required" },
];

const ZONES = ["Europe/Berlin", "UTC"];

const VISIBILITY: VisibilityChoice = {
  publicAllowed: true,
  loginHref: undefined,
  hasAccount: true,
  followers: { allowed: true },
  sharedBy: "@anna@runs.example.org",
  nearby: true,
};

function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note: string;
  children?: unknown;
}) {
  return (
    <section id={id} class="sg-section">
      <h2>{title}</h2>
      <p class="hint">{note}</p>
      {children}
    </section>
  );
}

export function StyleGuide(props: StyleGuideProps) {
  const { t, config, language, units, theme, csrfToken, returnTo } = props;
  const form = (
    values: PlanInput,
    options: { errors?: readonly FieldError[]; edit?: boolean } = {},
  ) => (
    <PlanForm
      t={t}
      values={values}
      errors={options.errors ?? []}
      csrfToken={csrfToken}
      nonce={options.edit === true ? undefined : "sample-nonce"}
      timeZones={ZONES}
      maxRetentionDays={30}
      action="/styleguide"
      heading={options.edit === true ? t("host.heading") : t("form.heading")}
      submitLabel={options.edit === true ? t("host.save") : t("form.submit")}
      withGpx={options.edit !== true}
      map={undefined}
      placeSearch={false}
      routeTrim=""
      units={units}
      visibility={VISIBILITY}
    />
  );
  return (
    <div class="sg">
      <h1>Style guide</h1>
      <p class="notice">
        Development only: the real views and the real stylesheet, in the language and theme chosen
        in the header menu. Not linked from any page, never indexed.
      </p>
      <nav aria-label="Sections">
        <ul>
          {SECTION_IDS.map((id) => (
            <li>
              <a href={`#${id}`}>{id}</a>
            </li>
          ))}
        </ul>
      </nav>

      <Section
        id="sg-typography"
        title="Typography"
        note="Headings, text, links, lists, code, rules."
      >
        <h1>Heading 1</h1>
        <h2>Heading 2</h2>
        <h3>Heading 3</h3>
        <h4>Heading 4</h4>
        <p>
          Body text with a <a href="#sg-typography">link</a>, <strong>strong</strong>,{" "}
          <em>emphasis</em> and <code>inline code</code>. A long unbroken word follows to check
          wrapping: Donaudampfschifffahrtsgesellschaftskapitaensmuetze.
        </p>
        <p class="hint">A hint: quieter, smaller text under a control.</p>
        <ul>
          <li>First item</li>
          <li>Second item</li>
        </ul>
        <ol>
          <li>First step</li>
          <li>Second step</li>
        </ol>
        <hr />
      </Section>

      <Section
        id="sg-buttons"
        title="Buttons"
        note="Primary, secondary, danger, disabled, and the secondary link-button."
      >
        <div class="button-row">
          <button type="button">Primary</button>
          <button type="button" class="secondary">
            Secondary
          </button>
          <button type="button" class="danger">
            Danger
          </button>
          <button type="button" disabled>
            Disabled
          </button>
          <a class="button secondary" href="#sg-buttons">
            Link button
          </a>
          <a class="button" href="#sg-buttons">
            Primary link
          </a>
        </div>
      </Section>

      <Section
        id="sg-inputs"
        title="Inputs"
        note="Text, search, email, select, textarea, date, time with step, colour, file; with hint and error variants; a two-column row."
      >
        <div class="field">
          <label for="sg-text">Text</label>
          <input id="sg-text" type="text" value="Plain text" />
          <p class="hint">A hint under the field.</p>
        </div>
        <div class="field field-invalid">
          <label for="sg-text-error">Text with an error</label>
          <input
            id="sg-text-error"
            type="text"
            value="Wrong"
            aria-invalid="true"
            aria-describedby="sg-text-error-message"
          />
          <p class="error" id="sg-text-error-message">
            Please fill this in.
          </p>
        </div>
        <div class="field">
          <label for="sg-search">Search</label>
          <input id="sg-search" type="search" />
        </div>
        <div class="field">
          <label for="sg-email">Email</label>
          <input id="sg-email" type="email" autocomplete="email" />
        </div>
        <div class="field">
          <label for="sg-select">Select</label>
          <select id="sg-select">
            <option>First</option>
            <option>Second</option>
          </select>
        </div>
        <div class="field">
          <label for="sg-textarea">Textarea</label>
          <textarea id="sg-textarea" rows={3}>
            Some longer text.
          </textarea>
        </div>
        <div class="field">
          <label for="sg-color">Colour</label>
          <input id="sg-color" type="color" value="#2e5bff" />
        </div>
        <div class="field">
          <label for="sg-file">File</label>
          <input id="sg-file" type="file" />
        </div>
        <div class="field-row">
          <div class="field">
            <label for="sg-date">Date</label>
            <input id="sg-date" type="date" value="2031-06-07" />
          </div>
          <div class="field">
            <label for="sg-time">Time</label>
            <input id="sg-time" type="time" step={900} value="07:30" />
          </div>
        </div>
      </Section>

      <Section
        id="sg-choices"
        title="Choices"
        note="Radio and checkbox groups in .choice labels, inside a fieldset with a legend."
      >
        <fieldset>
          <legend>Radio group</legend>
          <label class="choice">
            <input type="radio" name="sg-radio" value="a" checked />
            First choice
          </label>
          <label class="choice">
            <input type="radio" name="sg-radio" value="b" />
            Second choice
          </label>
          <label class="choice">
            <input type="radio" name="sg-radio" value="c" disabled />
            Unavailable choice
          </label>
        </fieldset>
        <fieldset>
          <legend>Checkbox group</legend>
          <label class="choice">
            <input type="checkbox" name="sg-check-a" checked />
            Ticked
          </label>
          <label class="choice">
            <input type="checkbox" name="sg-check-b" />
            Not ticked
          </label>
        </fieldset>
      </Section>

      <Section
        id="sg-notices"
        title="Notices"
        note="Notice, warning, error and hint paragraphs, and the link box."
      >
        <p class="notice" role="status">
          A notice.
        </p>
        <p class="warning">A warning.</p>
        <p class="error">An error.</p>
        <p class="hint">A hint.</p>
        <p class="link-box">https://runs.example.org/p/sample-plan</p>
      </Section>

      <Section
        id="sg-folds"
        title="Folds"
        note="The plan form's .fold groups, rendered by the real Fold: closed, open, warning, strong."
      >
        <div class="folds">
          <Fold title="Closed fold" value="One-line summary" open={false}>
            <p>Body of the fold.</p>
          </Fold>
          <Fold title="Open fold" value="One-line summary" open>
            <p>Body of the fold.</p>
          </Fold>
          <Fold title="Warning fold" value="Public: anyone can find it" open={false} warning>
            <p>Body of the fold.</p>
          </Fold>
          <Fold title="Strong fold" value="One-line summary" open={false} strong>
            <p>Body of the fold.</p>
          </Fold>
        </div>
      </Section>

      <Section
        id="sg-title"
        title="Title field"
        note="The title as the form's big heading with the pencil hint. Mirrors plan-form.tsx."
      >
        <div class="field field-title">
          <label class="visually-hidden" for="sg-title-input">
            Title
          </label>
          <div class="title-field">
            <input id="sg-title-input" class="title-input" value="Easy Sunday run" />
            <span class="icon icon-pencil title-edit-icon" aria-hidden="true"></span>
          </div>
        </div>
      </Section>

      <Section
        id="sg-lines"
        title="Lines, switch and readouts"
        note="Zone line and host-name line (mirror plan-form.tsx), the mode switch (real ModeSwitch), point readouts (mirror maps.tsx). No live map."
      >
        <details class="zone-line">
          <summary>
            <span>Europe/Berlin</span>
            {" · "}
            <span class="zone-change">{t("layout.change")}</span>
          </summary>
          <div class="field">
            <label for="sg-zone">Time zone</label>
            <select id="sg-zone">
              <option>Europe/Berlin</option>
            </select>
          </div>
        </details>
        <details class="host-name">
          <summary>
            {t("form.hostingAs", { name: "Anna" })}
            {" · "}
            <span class="zone-change">{t("layout.change")}</span>
          </summary>
          <div class="field">
            <label for="sg-host">Host name</label>
            <input id="sg-host" value="Anna" />
          </div>
        </details>
        <ModeSwitch t={t} />
        <div class="point-readout">
          <p>
            {t("map.areaSet")}
            {" · "}
            <button type="button" class="secondary">
              {t("map.areaRemove")}
            </button>
          </p>
        </div>
        <div class="point-readout">
          <p>{t("map.areaNone")}</p>
        </div>
      </Section>

      <Section
        id="sg-plan-form"
        title="Plan form"
        note="The real PlanForm in four states: empty create, create with errors, create with values and public visibility, host edit. Ids repeat across the four forms."
      >
        {form({ ...SAMPLE_VALUES, title: t("form.defaultTitle") })}
        <hr />
        {form({ ...SAMPLE_VALUES, title: "", date: "" }, { errors: ERRORS })}
        <hr />
        {form(FILLED_VALUES)}
        <hr />
        {form(FILLED_VALUES, { edit: true })}
      </Section>

      <Section
        id="sg-header-sheet"
        title="Header menu sheet"
        note="The real sheet content, always visible. The real header with its burger is at the top of the page."
      >
        <div class="sg-sheet">
          <MenuSheetBody
            t={t}
            config={config}
            language={language}
            units={units}
            theme={theme}
            languageSwitch={{ csrfToken, returnTo }}
            idPrefix="sg-preference"
          />
        </div>
      </Section>

      <Section
        id="sg-footer"
        title="Footer"
        note="The real footer is at the bottom of this page."
      />

      <Section
        id="sg-badges"
        title="Badges, metrics and plan blocks"
        note="Badge, initials, metric tiles, status boxes, when and where, exact start card, share row. Skipped: the plan page's people lists, the map and the respond form (they need plan data and plumbing)."
      >
        <p>
          <span class="badge">{t("plan.host")}</span>
        </p>
        <p>
          <Initial name="Anna" language={language} host />{" "}
          <PersonName name="Ben" language={language} />{" "}
          <PersonName name="Çağla" language={language} />{" "}
          <PersonName name="Dora" language={language} />
        </p>
        <PlanMetrics
          t={t}
          tiles
          units={units}
          language={language}
          details={{
            activity: "run",
            distanceMeters: 12500,
            elevationGainMeters: 120,
            pace: { fastest: 330, slowest: 360 },
          }}
        />
        <Status state="joined" heading="You are in" text="See you on Sunday." />
        <Status state="notAnswered" text="You have not answered yet." />
        <WhenWhere t={t} when="Sun, 7 Jun 2031, 07:30" where="Englischer Garten, north end" />
        <WhenWhereLines t={t} when="Sun, 7 Jun 2031, 07:30" where="Englischer Garten, north end" />
        <ExactStartSection
          t={t}
          exactStart={{
            point: { lat: 48.16321, lng: 11.60147 },
            description: "North gate, by the bike racks",
          }}
        />
        <ShareLinks
          t={t}
          url="https://runs.example.org/p/sample-plan"
          title="Easy Sunday run"
          buttons={["copy", "native", "whatsApp"]}
        />
      </Section>

      <Section
        id="sg-theme-colors"
        title="Theme colours"
        note="The colour tokens of app.css; switch the theme in the header menu."
      >
        <table class="sg-tokens">
          <thead>
            <tr>
              <th scope="col">Token</th>
              <th scope="col">Colour</th>
            </tr>
          </thead>
          <tbody>
            {THEME_TOKENS.map((token) => (
              <tr>
                <th scope="row">
                  <code>{`--${token}`}</code>
                </th>
                <td>
                  <span class={`sg-swatch sg-swatch-${token}`} aria-hidden="true"></span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
