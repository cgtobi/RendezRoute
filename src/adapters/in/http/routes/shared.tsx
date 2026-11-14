// Helpers shared by the routes: forms, rate limits, plan pages, and pages that only say what
// happened (errors, "gone"), also for the admin pages and the app itself.
import type { VisibilityChoices } from "../../../../application/public-plans.ts";
import { MessagePage } from "../views/message-page.tsx";
import { PostingClosed } from "../views/posting.tsx";
import type { PostingNeed } from "../../../../application/posting-rules.ts";
import { randomBytes } from "node:crypto";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AccountDeps } from "../../../../application/accounts.ts";
import { isSharedByActor, type PlanDeps } from "../../../../application/plans.ts";
import type { Geocoder, PreviewRenderer, WeatherProvider } from "../../../../application/ports.ts";
import { planWeather } from "../../../../application/weather.ts";
import type { VisibilityChoice } from "../views/plan-form.tsx";
import type { ViewPlanResult } from "../../../../application/plans.ts";
import { fediverseAddress } from "../../../../domain/actor.ts";
import { PLAN_INPUT_FIELDS, type PlanInput } from "../../../../domain/plan-input.ts";
import { clientKey, type RateLimits } from "../rate-limit.ts";
import { type Config, loginConfigured } from "../../../../config.ts";
import type { AppEnv } from "../app.tsx";
import { readDeviceToken } from "../device-cookie.ts";
import { MapAssets, type MapSettings } from "../views/maps.tsx";
import { PlanPage } from "../views/plan-page.tsx";
import type { RespondFormState } from "../views/respond-form.tsx";
import { PreviewTags } from "../views/preview-tags.tsx";
import { themeVersion } from "../views/theme-css.ts";
import { localizeDecimal } from "../views/format.ts";

export interface RouteDeps {
  config: Config;
  planDeps: PlanDeps;
  /** Place search; undefined when the geocoder is disabled (spec 3.9). */
  geocoder: Geocoder | undefined;
  previewRenderer: PreviewRenderer;
  /** Forecasts on plan pages; undefined when weather is disabled (spec 3.9). */
  weather: WeatherProvider | undefined;
  limits: RateLimits;
  vapidPublicKey: string;
  /** Plans can be reported: instance admin authentication is configured (spec 7 Moderation). */
  reporting: boolean;
  /** Accounts, when a way to log in is configured (spec 7 Identity). */
  accounts: AccountDeps | undefined;
}

/** The rate-limit key of the request's client; never logged (decision I18). */
export const clientOf = (c: Context<AppEnv>) => clientKey(c.get("clientIp"));

export function tooManyRequests(c: Context<AppEnv>, retryAfterSeconds: number) {
  c.header("retry-after", String(retryAfterSeconds));
  return messagePage(c, 429, c.get("t")("error.rateLimited"));
}

/** Tile settings for browser maps, or undefined when maps are disabled (spec 3.9). */
export const mapSettings = (config: Config): MapSettings | undefined =>
  config.maps.enabled
    ? { tileUrl: config.maps.tileUrl, attribution: config.maps.attribution }
    : undefined;

/** One-time form value (decision I9). */
export const newNonce = () => randomBytes(16).toString("base64url");

/** Parsed form fields, or undefined for a malformed body. */
export async function readForm(c: Context): Promise<Record<string, unknown> | undefined> {
  try {
    return await c.req.parseBody();
  } catch {
    return undefined;
  }
}

export const formField = (body: Record<string, unknown>, name: string): string =>
  typeof body[name] === "string" ? body[name] : "";

/** The bytes of an uploaded file field, or undefined if none was chosen. */
export async function formFile(
  body: Record<string, unknown>,
  name: string,
): Promise<Uint8Array | undefined> {
  const file = body[name];
  if (!(file instanceof File) || file.size === 0) return undefined;
  return new Uint8Array(await file.arrayBuffer());
}

/** A PlanInput with every field taken from `value`. */
export const planInput = (value: (field: string) => string): PlanInput =>
  Object.fromEntries(PLAN_INPUT_FIELDS.map((field) => [field, value(field)])) as PlanInput;

/** Responses that carry or follow a secret link (spec 3.2, 3.8). */
export function secretLinkHeaders(c: Context): void {
  c.header("referrer-policy", "no-referrer");
  c.header("cache-control", "no-store");
}

/**
 * The relative way from an admin page back to the app's root: "../" from /admin/ and
 * /admin/login, "../../" from /admin/plans/<id>, and so on.
 */
export function adminRoot(path: string): string {
  if (!path.startsWith("/admin/")) throw new Error(`Not an admin page: ${path}`);
  const depth = path.slice("/admin/".length).split("/").length - 1;
  return "../".repeat(depth + 1);
}

/**
 * A page that only says what happened, e.g. an error (decision D29); it sets no cookie. Under
 * /admin/ it keeps relative links, so it works under any path prefix, and like every admin
 * response it is neither stored nor indexed (decision I46).
 */
export function messagePage(c: Context, status: ContentfulStatusCode, message: string) {
  const admin = c.req.path.startsWith("/admin/");
  if (admin) {
    c.header("cache-control", "no-store");
    c.header("x-robots-tag", "noindex");
  }
  c.status(status);
  return c.render(<MessagePage message={message} />, {
    title: message,
    pathBase: admin ? adminRoot(c.req.path) : undefined,
    plain: true,
  });
}

export function badRequest(c: Context<AppEnv>) {
  return messagePage(c, 400, c.get("t")("error.badRequest"));
}

export function planGone(c: Context<AppEnv>) {
  return messagePage(c, 404, c.get("t")("plan.gone"));
}

/**
 * The posting rules keep this device from creating plans: how to get an invite or log in (spec 7
 * Moderation). The page in place of the form answers 200; a form sent anyway answers 403.
 */
export function postingClosed(
  c: Context<AppEnv>,
  config: Config,
  requirement: PostingNeed,
  status: 200 | 403,
) {
  const t = c.get("t");
  const heading = t(requirement === "invite" ? "posting.heading" : "posting.loginHeading");
  c.status(status);
  c.header("cache-control", "private, no-store");
  return c.render(
    <PostingClosed
      t={t}
      requirement={requirement}
      contactEmail={config.contactEmail}
      heading={{ level: 1, text: heading }}
    />,
    { title: heading },
  );
}

/**
 * Templates have no public page: an unknown template and one this device is not linked to look the
 * same (decision I43).
 */
export function templateGone(c: Context<AppEnv>) {
  return messagePage(c, 404, c.get("t")("template.gone"));
}

/** Renders a found plan for its audience, with the response form for viewers. */
export async function renderPlanPage(
  c: Context<AppEnv>,
  {
    config,
    planDeps,
    weather,
    reporting,
  }: Pick<RouteDeps, "config" | "planDeps" | "weather" | "reporting">,
  result: Exclude<ViewPlanResult, { kind: "not_found" }>,
  form: Omit<RespondFormState, "csrfToken"> = {
    displayName: "",
    requestNote: "",
    errorCode: undefined,
    noteErrorCode: undefined,
    nonce: newNonce(),
  },
) {
  c.header("cache-control", "private, no-cache");
  const map = mapSettings(config);
  const showForm = result.kind === "viewer" && result.responsesOpen;
  const { responsesOpen, hasRecap, preview: _preview, ...audience } = result;
  const sharedByActor = showForm && (await isSharedByActor(planDeps, result.view.id));
  const forecast = await planWeather({ weather, clock: planDeps.clock }, result.view);
  return c.render(
    <PlanPage
      t={c.get("t")}
      language={c.get("language")}
      units={c.get("units")}
      audience={audience}
      responsesOpen={responsesOpen}
      respondForm={showForm ? { ...form, csrfToken: c.get("csrfToken")() } : undefined}
      map={map}
      planUrl={new URL(`/p/${result.view.id}`, config.baseUrl).href}
      forecast={forecast}
      hasRecap={hasRecap}
      csrfToken={c.get("csrfToken")()}
      reporting={reporting}
      fediverseNote={fediverseNote(config, sharedByActor)}
    />,
    {
      title: result.view.title,
      wide: true,
      head: (
        <>
          <link
            rel="stylesheet"
            href={`/p/${result.view.id}/theme.css?v=${themeVersion(result.view.colors)}`}
          />
          {map !== undefined && result.view.area.point !== undefined && <MapAssets />}
          <PreviewTags
            preview={result.preview}
            baseUrl={config.baseUrl}
            siteName={config.instanceName}
          />
        </>
      ),
    },
  );
}

/**
 * Mastodon can follow but not join: the plan page says so where the fediverse can find the plan
 * (a profile shares it) and people can still join.
 */
const fediverseNote = (config: Config, joinable: boolean) =>
  config.federationEnabled && joinable
    ? config.fediverseLogin !== undefined
      ? "login"
      : "general"
    : undefined;

/** The time zones offered by the plan and template forms. */
export const TIME_ZONES = (() => {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
})();

/** The stored distance with the language's decimal separator, e.g. "12,5" in German (decision I31). */
export function localizedInput(input: PlanInput, language: string): PlanInput {
  return { ...input, distanceKm: localizeDecimal(input.distanceKm, language) };
}

/** How the last "Email me my links" went, right after it (decision D31). */
export function linkEmailOutcome(c: Context<AppEnv>): "sent" | "failed" | undefined {
  const value = c.req.query("linkEmailed");
  return value === "sent" || value === "failed" ? value : undefined;
}

/** "?signedOut=N" after "Sign out all other devices", for the notice on the page (decision I44). */
export function signedOutCount(c: Context<AppEnv>): number | undefined {
  const value = c.req.query("signedOut");
  return value !== undefined && /^\d{1,6}$/.test(value) ? Number(value) : undefined;
}

/**
 * A notification setting on a manage or host page (decisions D31, D33): who asks, as responder or
 * host; the page to return to; and the plan's page for those it does not belong to.
 */
export function switchRoute(
  c: Context<AppEnv>,
  config: Config,
  role: "responder" | "host",
  base: string,
): {
  request: { planId: string; deviceToken: string | undefined; role: "responder" | "host" };
  page: string;
  plan: string;
} {
  const planId = c.req.param("id") ?? "";
  return {
    request: { planId, deviceToken: readDeviceToken(c, config), role },
    page: base.replace(":id", planId),
    plan: `/p/${planId}`,
  };
}

/**
 * "Who can find this plan" on the plan, host and template forms (decision D35): whether public
 * may be chosen, as the use case decided, and the account page to log in on, if the instance
 * offers a login.
 */
export const visibilityChoice = (config: Config, choices: VisibilityChoices): VisibilityChoice => ({
  publicAllowed: choices.publicAllowed,
  hasAccount: choices.hasAccount,
  // Logging in cannot help while public plans are not offered (Nearby off, decision I59).
  loginHref: loginConfigured(config) && config.nearbyEnabled ? "/account" : undefined,
  // Only accounts have profiles: without a login, followers could never be chosen anew.
  followers:
    loginConfigured(config) || choices.followers?.allowed === true ? choices.followers : undefined,
  sharedBy:
    choices.sharedBy === undefined
      ? undefined
      : fediverseAddress(choices.sharedBy, config.baseUrl.hostname),
  nearby: config.nearbyEnabled,
  fediverse: choices.fediverse,
});
