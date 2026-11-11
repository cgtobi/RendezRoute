// Plan routes (spec 5 features 1 and 3).
import { publicAllowedFor } from "../../../../application/public-plans.ts";
import type { Context, Hono } from "hono";
import { createPlan, viewPlan, viewPlanTheme } from "../../../../application/plans.ts";
import { viewAccount } from "../../../../application/accounts.ts";
import { postingNeed } from "../../../../application/posting-rules.ts";
import { DEFAULT_COLORS } from "../../../../domain/color.ts";
import type { FieldError, PlanInput } from "../../../../domain/plan-input.ts";
import { previewImage } from "../../../../application/previews.ts";
import { routeForDownload } from "../../../../application/routes.ts";
import { toGeoJson, toGpx } from "../../../out/gpx/write-gpx.ts";
import type { AppEnv } from "../app.tsx";
import { fileName } from "../file-names.ts";
import { readDeviceToken, setDeviceToken } from "../device-cookie.ts";
import { formatDate } from "../views/format.ts";
import { LinksPage } from "../views/links-page.tsx";
import { MapAssets } from "../views/maps.tsx";
import { ROUTE_TRIM_FIELD } from "../views/route-trim.tsx";
import { PlanForm } from "../views/plan-form.tsx";
import { themeCss } from "../views/theme-css.ts";
import {
  badRequest,
  formField,
  formFile,
  postingClosed,
  mapSettings,
  messagePage,
  newNonce,
  planGone,
  planInput,
  readForm,
  renderPlanPage,
  type RouteDeps,
  clientOf,
  tooManyRequests,
  secretLinkHeaders,
  TIME_ZONES,
  visibilityChoice,
} from "./shared.tsx";

export function registerPlanRoutes(app: Hono<AppEnv>, deps: RouteDeps) {
  const { config, planDeps, geocoder, previewRenderer, limits, accounts } = deps;
  const emptyForm = (): PlanInput => ({
    ...planInput(() => ""),
    activity: "run",
    timeZone: config.defaultTimezone,
    dropPolicy: "no_drop",
    primaryColor: DEFAULT_COLORS.primary,
    secondaryColor: DEFAULT_COLORS.secondary,
  });

  const renderForm = async (
    c: Context<AppEnv>,
    values: PlanInput,
    errors: readonly FieldError[],
    nonce: string,
    routeTrim = "",
  ) => {
    // Public is chosen for the plan this device will own (decision D35).
    const publicAllowed = await publicAllowedFor(planDeps, {
      deviceToken: readDeviceToken(c, config),
    });
    return c.render(
      <PlanForm
        t={c.get("t")}
        values={values}
        errors={errors}
        csrfToken={c.get("csrfToken")()}
        nonce={nonce}
        timeZones={TIME_ZONES}
        maxRetentionDays={config.maxRetentionDays}
        action="/new"
        heading={c.get("t")("form.heading")}
        submitLabel={c.get("t")("form.submit")}
        withGpx
        map={mapSettings(config)}
        placeSearch={geocoder !== undefined}
        units={c.get("units")}
        detectZoneFrom={errors.length === 0 ? config.defaultTimezone : undefined}
        routeTrim={routeTrim}
        visibility={visibilityChoice(config, publicAllowed)}
      />,
      { title: c.get("t")("form.heading"), head: <MapAssets /> },
    );
  };

  app.get("/new", async (c) => {
    // With POSTING_MODE=invite, how to get an invite instead of a form the device cannot send.
    const needs = await postingNeed(planDeps, { deviceToken: readDeviceToken(c, config) });
    if (needs !== undefined) return postingClosed(c, config, needs, 200);
    // A logged-in poster's display name fills the name field (spec 7 Identity).
    const account =
      accounts === undefined
        ? undefined
        : await viewAccount(accounts, { deviceToken: readDeviceToken(c, config) });
    const posterName = account?.kind === "account" ? (account.displayName ?? "") : "";
    return renderForm(c, { ...emptyForm(), posterName }, [], newNonce());
  });

  app.post("/new", async (c) => {
    const body = await readForm(c);
    if (body === undefined) return badRequest(c);
    const values = planInput((field) => formField(body, field));
    const client = clientOf(c);
    const gpx = await formFile(body, "gpx");
    // A route file always counts: parsing it is the costly part (decision I32).
    if (gpx !== undefined && gpx.byteLength > 0) {
      const routeAllowed = limits.route.take(client);
      if (!routeAllowed.ok) return tooManyRequests(c, routeAllowed.retryAfterSeconds);
    }
    // Reserved before any work, given back unless a plan is created, so fixing form errors is
    // never blocked and parallel requests cannot exceed the burst.
    const allowed = limits.create.take(client);
    if (!allowed.ok) return tooManyRequests(c, allowed.retryAfterSeconds);

    const result = await createPlan(planDeps, {
      input: values,
      units: c.get("units"),
      language: c.get("language"),
      creationNonce: formField(body, "nonce"),
      deviceToken: readDeviceToken(c, config),
      gpx,
      routeTrim: formField(body, ROUTE_TRIM_FIELD),
    });
    if (result.kind !== "created") limits.create.refund(client);

    switch (result.kind) {
      case "bad_request":
        return badRequest(c);
      case "not_allowed":
        return postingClosed(c, config, result.needs, 403);
      case "duplicate":
        return c.redirect(`/p/${result.planId}`, 303);
      case "invalid":
        c.status(422);
        return renderForm(
          c,
          values,
          result.errors,
          formField(body, "nonce"),
          formField(body, ROUTE_TRIM_FIELD),
        );
      case "created": {
        if (result.newDeviceToken !== undefined) setDeviceToken(c, config, result.newDeviceToken);
        secretLinkHeaders(c);
        const planPath = `/p/${result.planId}`;
        return c.render(
          <LinksPage
            t={c.get("t")}
            planUrl={new URL(planPath, config.baseUrl).href}
            planPath={planPath}
            title={result.title}
            hostUrl={new URL(`/a/${result.hostToken}`, config.baseUrl).href}
            deletion={formatDate(result.deleteAt, result.timeZone, c.get("language"))}
            recapWindowShortened={result.recapWindowShortened}
          />,
          { title: c.get("t")("links.heading") },
        );
      }
    }
  });

  /** Public per-plan colors; the plan page links it with a color version, so it can be cached for long. */
  app.get("/p/:id/theme.css", async (c) => {
    const result = await viewPlanTheme(planDeps, { planId: c.req.param("id") });
    if (result.kind === "not_found") return planGone(c);
    c.header("content-type", "text/css; charset=utf-8");
    c.header("cache-control", "public, max-age=31536000, immutable");
    return c.body(themeCss(result.theme));
  });

  /** Regenerated GPX for participants and the host; 404 for everyone else (spec 3.6, P4, D10). */
  app.get("/p/:id/route.gpx", async (c) => {
    const result = await routeForDownload(planDeps, {
      planId: c.req.param("id"),
      deviceToken: readDeviceToken(c, config),
    });
    if (result.kind === "not_found") return planGone(c);
    c.header("content-type", "application/gpx+xml; charset=utf-8");
    c.header(
      "content-disposition",
      `attachment; filename="${fileName(result.title, "route")}.gpx"`,
    );
    c.header("cache-control", "private, no-store");
    return c.body(toGpx(result.route, result.title));
  });

  /** Card image for link previews (spec 3.3); public, cached per plan version. */
  app.get("/p/:id/og.png", async (c) => {
    // Only renders count: cached cards stay available to chat apps' fetchers.
    let retryAfterSeconds = 0;
    const result = await previewImage(
      { plans: planDeps.plans, renderer: previewRenderer },
      {
        planId: c.req.param("id"),
        mayRender: () => {
          const allowed = limits.preview.take(clientOf(c));
          if (!allowed.ok) retryAfterSeconds = allowed.retryAfterSeconds;
          return allowed.ok;
        },
      },
    );
    if (result.kind === "not_found") return planGone(c);
    if (result.kind === "limited") return tooManyRequests(c, retryAfterSeconds);
    if (result.kind === "busy") {
      c.header("retry-after", "5");
      return messagePage(c, 503, c.get("t")("error.busy"));
    }
    c.header("content-type", "image/png");
    c.header("cache-control", "public, max-age=3600");
    return c.body(Uint8Array.from(result.image));
  });

  /** The route for the plan map; same audience as the GPX download (decision D12). */
  app.get("/p/:id/route.geojson", async (c) => {
    const result = await routeForDownload(planDeps, {
      planId: c.req.param("id"),
      deviceToken: readDeviceToken(c, config),
    });
    if (result.kind === "not_found") return planGone(c);
    c.header("content-type", "application/geo+json");
    c.header("cache-control", "private, no-store");
    return c.body(JSON.stringify(toGeoJson(result.route)));
  });

  app.get("/p/:id", async (c) => {
    const result = await viewPlan(planDeps, {
      planId: c.req.param("id"),
      deviceToken: readDeviceToken(c, config),
      withRatingResult: true,
    });
    return result.kind === "not_found" ? planGone(c) : renderPlanPage(c, deps, result);
  });
}
