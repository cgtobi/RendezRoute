// Helpers shared by the plan, response and secret-link routes.
import { randomBytes } from "node:crypto";
import type { Context } from "hono";
import type { PlanDeps } from "../../../../application/plans.ts";
import type { Geocoder, PreviewRenderer } from "../../../../application/ports.ts";
import type { ViewPlanResult } from "../../../../application/plans.ts";
import { PLAN_INPUT_FIELDS, type PlanInput } from "../../../../domain/plan-input.ts";
import { clientKey, type RateLimits } from "../rate-limit.ts";
import type { Config } from "../../../../config.ts";
import type { AppEnv } from "../app.tsx";
import { MapAssets, type MapSettings } from "../views/maps.tsx";
import { PlanPage } from "../views/plan-page.tsx";
import type { RespondFormState } from "../views/respond-form.tsx";
import { PreviewTags } from "../views/preview-tags.tsx";
import { themeVersion } from "../views/theme-css.ts";

export interface RouteDeps {
  config: Config;
  planDeps: PlanDeps;
  /** Place search; undefined when the geocoder is disabled (spec 3.9). */
  geocoder: Geocoder | undefined;
  previewRenderer: PreviewRenderer;
  limits: RateLimits;
  vapidPublicKey: string;
}

/** The rate-limit key of the request's client; never logged (decision I18). */
export const clientOf = (c: Context<AppEnv>) => clientKey(c.get("clientIp"));

export function tooManyRequests(c: Context<AppEnv>, retryAfterSeconds: number) {
  c.header("retry-after", String(retryAfterSeconds));
  return c.text(c.get("t")("error.rateLimited"), 429);
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

export function badRequest(c: Context<AppEnv>) {
  return c.text(c.get("t")("error.badRequest"), 400);
}

export function planGone(c: Context<AppEnv>) {
  c.status(404);
  return c.render(<p class="gone">{c.get("t")("plan.gone")}</p>, {
    title: c.get("t")("plan.gone"),
  });
}

/** Renders a found plan for its audience, with the response form for viewers. */
export function renderPlanPage(
  c: Context<AppEnv>,
  config: Config,
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
  const { responsesOpen, preview: _preview, ...audience } = result;
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
    />,
    {
      title: result.view.title,
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
