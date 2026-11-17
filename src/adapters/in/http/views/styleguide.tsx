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
import { RequiredHint } from "./line-field.tsx";
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

const SAMPLE_KINDS = [
  "text",
  "email",
  "search",
  "textarea",
  "select",
  "date",
  "time",
  "file",
  "color",
] as const;
type SampleKind = (typeof SAMPLE_KINDS)[number];
type SampleState = "rest" | "filled" | "required" | "error" | "disabled";

/** The states each kind shows: a file field has no value to show, a colour is never empty. */
const SAMPLE_STATES: Record<SampleKind, readonly SampleState[]> = {
  text: ["rest", "filled", "required", "error", "disabled"],
  email: ["rest", "filled", "required", "error", "disabled"],
  search: ["rest", "filled", "required", "error", "disabled"],
  textarea: ["rest", "filled", "required", "error", "disabled"],
  select: ["rest", "filled", "required", "error", "disabled"],
  date: ["rest", "filled", "required", "error", "disabled"],
  time: ["rest", "filled", "required", "error", "disabled"],
  file: ["rest", "required", "error", "disabled"],
  color: ["rest", "error", "disabled"],
};

const SAMPLE_VALUE: Record<SampleKind, string> = {
  text: "Easy Sunday run",
  email: "anna@example.org",
  search: "Englischer Garten",
  textarea: "Some longer text on a second line of the sample.",
  select: "2",
  date: "2031-06-07",
  time: "07:30",
  file: "",
  color: "#2e5bff",
};

/** One field of the inputs section in one state, built like the real forms build theirs. */
function FieldSample({ t, kind, state }: { t: Translate; kind: SampleKind; state: SampleState }) {
  const id = `sg-${kind}-${state}`;
  const required = state === "required";
  const invalid = state === "error";
  const value = state === "filled" || invalid ? SAMPLE_VALUE[kind] : undefined;
  const disabled = state === "disabled";
  const props = {
    id,
    disabled,
    required,
    "aria-required": required ? "true" : undefined,
    "aria-invalid": invalid ? "true" : undefined,
    "aria-describedby": invalid ? `${id}-error` : disabled ? `${id}-reason` : undefined,
  };
  const textLike = kind === "text" || kind === "email" || kind === "search" || kind === "textarea";
  // Empty text-like samples show an example (decision D74); a required one keeps the blank
  // placeholder CSS needs, as in the forms that have no example.
  const placeholder = !textLike
    ? undefined
    : required
      ? " "
      : state === "rest" || disabled
        ? "An example"
        : undefined;
  const control =
    kind === "textarea" ? (
      <textarea {...props} rows={3} placeholder={placeholder}>
        {value}
      </textarea>
    ) : kind === "select" ? (
      <select {...props}>
        <option value="">Choose</option>
        <option value="1">First</option>
        <option value="2" selected={value === "2" || undefined}>
          Second
        </option>
      </select>
    ) : (
      <input
        {...props}
        type={kind}
        value={value}
        placeholder={placeholder}
        step={kind === "time" ? 900 : undefined}
      />
    );
  return (
    <div class={invalid ? "field field-invalid" : "field"}>
      <label for={id}>{`${kind}, ${state}`}</label>
      {control}
      {required && kind !== "date" && kind !== "time" && <RequiredHint t={t} controlId={id} />}
      {state === "rest" && <p class="hint">A hint under the field.</p>}
      {disabled && (
        <p class="hint" id={`${id}-reason`}>
          This field cannot be changed here, because the sample is switched off.
        </p>
      )}
      {invalid && (
        <p class="error" id={`${id}-error`}>
          {t("field.required")}
        </p>
      )}
    </div>
  );
}

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
        note="Every field type in the one line style (decision D73), each at rest, filled, empty and required (red hint; none under date and time until a failed submit, D74), with an error and disabled (with its reason below). Hover or tab into a field to see its focus. The first row at rest also has a hint."
      >
        {SAMPLE_KINDS.map((kind) => (
          <div class="sg-samples">
            <h3>{kind}</h3>
            {SAMPLE_STATES[kind].map((state) => (
              <FieldSample t={t} kind={kind} state={state} />
            ))}
          </div>
        ))}
        <div class="field-row">
          <div class="field">
            <label for="sg-pair-date">Date and time side by side</label>
            <input id="sg-pair-date" type="date" value="2031-06-07" />
          </div>
          <div class="field">
            <label for="sg-pair-time">Time</label>
            <input id="sg-pair-time" type="time" step={900} value="07:30" />
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
        note="The plan form's .fold groups, rendered by the real Fold: closed, open, warning, summary only when closed."
      >
        <div class="folds">
          <Fold title="Closed fold" value="One-line summary" open={false}>
            <p>Body of the fold.</p>
          </Fold>
          <Fold title="Open fold" value="One-line summary" open>
            <p>Body of the fold.</p>
          </Fold>
          <Fold title="Summary only when closed" value="One-line summary" open hideValueOpen>
            <p>Body of the fold, open: no summary line (the "who" fold).</p>
          </Fold>
          <Fold title="Warning fold" value="Public: anyone can find it" open={false} warning>
            <p>Body of the fold.</p>
          </Fold>
        </div>
      </Section>

      <Section
        id="sg-title"
        title="Title field"
        note="The title as the form's big heading. Mirrors plan-form.tsx."
      >
        <div class="field field-title">
          <label class="visually-hidden" for="sg-title-input">
            Title
          </label>
          <input
            id="sg-title-input"
            class="title-input"
            value="Easy Sunday run"
            required
            placeholder=" "
            aria-required="true"
          />
          <RequiredHint t={t} controlId="sg-title-input" />
        </div>
        <div class="field field-title">
          <label class="visually-hidden" for="sg-title-empty">
            Title, emptied
          </label>
          <input
            id="sg-title-empty"
            class="title-input"
            required
            placeholder=" "
            aria-required="true"
          />
          <RequiredHint t={t} controlId="sg-title-empty" />
        </div>
      </Section>

      <Section
        id="sg-lines"
        title="Lines, switch and readouts"
        note="The icon button on a field's line (mirrors the area field with its place search, D75 and D77; the quiet remove button mirrors the map status lines, D76), zone line and host-name line (mirror plan-form.tsx), the mode switch (real ModeSwitch), point readouts (mirror maps.tsx). No live map."
      >
        <div class="field">
          <label for="sg-line-action">Field with an icon button</label>
          <div class="inline-input line-action">
            <input id="sg-line-action" type="text" placeholder={t("placeholder.areaSearch")} />
            <button type="button" class="line-action-button">
              <span class="icon icon-search" aria-hidden="true"></span>
              <span class="visually-hidden">{t("map.searchButton")}</span>
            </button>
          </div>
        </div>
        <details class="zone-line">
          <summary>
            <span class="zone-title">{t("form.timeZoneLine")}</span>{" "}
            <span data-zone-name>Europe/Berlin</span>
            {" · "}
            <span class="zone-change zone-change-closed">{t("layout.change")}</span>
            <span class="zone-change zone-change-open">{t("layout.done")}</span>
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
            <span class="zone-change zone-change-closed">{t("layout.change")}</span>
            <span class="zone-change zone-change-open">{t("layout.done")}</span>
          </summary>
          <div class="field">
            <label for="sg-host">Host name</label>
            <input id="sg-host" value="Anna" />
          </div>
        </details>
        <ModeSwitch t={t} />
        <div class="point-readout">
          <p>
            <span class="readout-text">{t("map.areaSet")}</span>
            <button type="button" class="icon-button">
              <span class="icon icon-close" aria-hidden="true"></span>
              <span class="visually-hidden">{t("map.areaRemove")}</span>
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
