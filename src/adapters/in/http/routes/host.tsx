// Host page routes (spec 5 features 7–9).
import type { Context, Hono } from "hono";
import {
  cancelPlan,
  deletePlan,
  editPlan,
  acceptRequest,
  rejectRequest,
  removePerson,
  restorePerson,
  viewHostPage,
} from "../../../../application/host.ts";
import type { FieldError, PlanInput } from "../../../../domain/plan-input.ts";
import type { AppEnv } from "../app.tsx";
import { readDeviceToken } from "../device-cookie.ts";
import { DeleteConfirm, HostPage } from "../views/host-page.tsx";
import { recapWindowParam } from "../views/recap.tsx";
import { MapAssets } from "../views/maps.tsx";
import { themeVersion } from "../views/theme-css.ts";
import { ROUTE_TRIM_FIELD } from "../views/route-trim.tsx";
import { deleteRecap } from "../../../../application/recap.ts";
import { emailProps, registerEmailForms } from "./email.tsx";
import { ntfyProps, registerNtfyForms } from "./ntfy.tsx";
import { registerTelegramForms, telegramProps } from "./telegram.tsx";
import { removeRoute } from "../../../../application/routes.ts";
import {
  badRequest,
  formField,
  formFile,
  mapSettings,
  planGone,
  planInput,
  readForm,
  type RouteDeps,
  clientOf,
  localizedInput,
  newNonce,
  TIME_ZONES,
  signedOutCount,
  visibilityChoice,
} from "./shared.tsx";
import { linkEmailProps } from "./link-tools.tsx";

export function registerHostRoutes(app: Hono<AppEnv>, deps: RouteDeps) {
  const { config, planDeps, geocoder, limits, vapidPublicKey } = deps;
  const request = (c: Context<AppEnv>) => ({
    planId: c.req.param("id") ?? "",
    deviceToken: readDeviceToken(c, config),
  });

  const render = async (
    c: Context<AppEnv>,
    form: {
      values?: PlanInput;
      errors?: readonly FieldError[];
      confirmDeleteNow?: boolean;
      confirmAcceptPending?: number;
      routeTrim?: string;
      /** A file was chosen but not saved: the browser does not keep it for the page shown again. */
      gpxDropped?: boolean;
      email?: { value: string; error: string };
    } = {},
  ) => {
    const page = await viewHostPage(planDeps, { ...request(c), units: c.get("units") });
    if (page.kind === "not_found") return planGone(c);
    if (page.kind === "forbidden") return c.redirect(`/p/${request(c).planId}`, 303);
    const email = await emailProps(
      planDeps,
      { ...request(c), role: "host" },
      `/p/${page.planId}/host`,
      form.email,
    );
    c.header("cache-control", "private, no-store");
    return c.render(
      <HostPage
        t={c.get("t")}
        visibility={visibilityChoice(config, page.visibility)}
        language={c.get("language")}
        planId={page.planId}
        title={page.title}
        scope={page.scope}
        canCancel={page.canCancel}
        requestsOpen={page.requestsOpen}
        push={{ endpoint: `/p/${page.planId}/host/notifications`, vapidPublicKey }}
        people={page.people}
        values={form.values ?? localizedInput(page.input, c.get("language"))}
        units={c.get("units")}
        errors={form.errors ?? []}
        csrfToken={c.get("csrfToken")()}
        timeZones={TIME_ZONES}
        maxRetentionDays={config.maxRetentionDays}
        saved={c.req.query("saved") !== undefined}
        recapWindowShortened={recapWindowParam(c.req.query("recapShortened"))}
        confirmDeleteNow={form.confirmDeleteNow ?? false}
        confirmAcceptPending={form.confirmAcceptPending}
        hasRoute={page.hasRoute}
        recapContributions={page.recapContributions}
        rating={page.rating}
        templateNonce={newNonce()}
        signedOut={signedOutCount(c)}
        linkEmail={await linkEmailProps(c, planDeps, {
          kind: "host",
          id: page.planId,
          deviceToken: readDeviceToken(c, config),
        })}
        linkNonce={newNonce()}
        routeTrim={form.routeTrim ?? ""}
        gpxDropped={form.gpxDropped ?? false}
        map={mapSettings(config)}
        placeSearch={geocoder !== undefined}
        email={email}
        ntfy={await ntfyProps(planDeps, { ...request(c), role: "host" }, `/p/${page.planId}/host`)}
        telegram={await telegramProps(
          planDeps,
          { ...request(c), role: "host" },
          `/p/${page.planId}/host`,
        )}
      />,
      {
        title: c.get("t")("host.heading"),
        // Map tools exist only in the full edit form; the form stays neutral (decision D11).
        // The bold palette alone takes the plan's colour here (links, controls, the logo), so
        // only then is the plan's public theme stylesheet linked; other palettes render as before.
        head: (
          <>
            {(c.get("palette") ?? config.palette) === "bold" && (
              <link
                rel="stylesheet"
                href={`/p/${page.planId}/theme.css?v=${themeVersion({ primary: page.input.primaryColor, secondary: page.input.secondaryColor })}`}
              />
            )}
            {page.scope === "all" && <MapAssets pathBase="/" />}
          </>
        ),
      },
    );
  };

  /** Shared outcome handling for actions that only redirect. */
  const afterAction = (c: Context<AppEnv>, result: { kind: string }, target: string) => {
    if (result.kind === "not_found") return planGone(c);
    if (result.kind === "forbidden") return c.redirect(`/p/${request(c).planId}`, 303);
    // A refused action changed nothing, so no "Changes saved." notice.
    if (result.kind === "not_allowed") return c.redirect(`/p/${request(c).planId}/host`, 303);
    return c.redirect(target, 303);
  };

  app.get("/p/:id/host", (c) => render(c));

  registerNtfyForms(app, deps, { role: "host", base: "/p/:id/host" });
  registerTelegramForms(app, deps, { role: "host", base: "/p/:id/host" });
  registerEmailForms(app, deps, {
    role: "host",
    base: "/p/:id/host",
    rerender: (c, email) => render(c, { email }),
  });

  /** The edit form, with a route file if one was chosen: saved all or nothing (decision D10). */
  app.post("/p/:id/host", async (c) => {
    const body = await readForm(c);
    if (body === undefined) return badRequest(c);
    const values = planInput((field) => formField(body, field));
    const { planId } = request(c);
    // An empty file part is no file.
    const gpx = await formFile(body, "gpx");
    const routeTrim = formField(body, ROUTE_TRIM_FIELD);
    // Shown again, the page has lost the chosen file: the host is asked to choose it again.
    const gpxDropped = gpx !== undefined;
    const client = clientOf(c);
    if (gpx !== undefined) {
      // Every route file counts: parsing it is the costly part (decision I32). Nothing is saved.
      const allowed = limits.route.take(client);
      if (!allowed.ok) {
        c.header("retry-after", String(allowed.retryAfterSeconds));
        c.status(429);
        // Like the 422 below, this re-render drops a submitted confirmAcceptPending (and
        // confirmDeleteNow): the host is asked again with the next save, never accepted silently.
        return render(c, {
          values,
          errors: [{ field: "gpx", code: "route_rate_limited" }],
          routeTrim,
          gpxDropped,
        });
      }
    }
    const result = await editPlan(planDeps, {
      ...request(c),
      input: values,
      units: c.get("units"),
      confirmDeleteNow: formField(body, "confirmDeleteNow") === "1",
      confirmAcceptPending: Number(formField(body, "confirmAcceptPending")) || undefined,
      route: gpx === undefined ? undefined : { gpx, trim: routeTrim },
    });
    // Refused for a nearly full disk before the file was read: no parsing was paid for.
    if (
      gpx !== undefined &&
      result.kind === "invalid" &&
      result.errors.some((error) => error.field === "gpx" && error.code === "storage_low")
    ) {
      limits.route.refund(client);
    }
    switch (result.kind) {
      case "updated": {
        const shortened = result.recapWindowShortened;
        return c.redirect(
          `/p/${planId}/host?saved${shortened === undefined ? "" : `&recapShortened=${shortened}`}`,
          303,
        );
      }
      case "deleted":
        return c.redirect(`/p/${planId}`, 303);
      case "confirm_delete_now":
        return render(c, { values, confirmDeleteNow: true });
      case "confirm_accept_pending":
        return render(c, {
          values,
          confirmAcceptPending: result.count,
          routeTrim,
          gpxDropped,
        });
      case "invalid":
        // A submitted confirmAcceptPending is not passed on: the next save asks the host again.
        c.status(422);
        return render(c, { values, errors: result.errors, routeTrim, gpxDropped });
      default:
        return afterAction(c, result, `/p/${planId}`);
    }
  });

  app.post("/p/:id/host/cancel", async (c) => {
    const result = await cancelPlan(planDeps, request(c));
    return afterAction(c, result, `/p/${request(c).planId}/host`);
  });

  /** "Delete recap" (spec 6 feature 7); the host page asks first. */
  app.post("/p/:id/host/recap/delete", async (c) => {
    const result = await deleteRecap(planDeps, request(c));
    return afterAction(c, result, `/p/${request(c).planId}#recap`);
  });

  app.get("/p/:id/host/delete", async (c) => {
    const page = await viewHostPage(planDeps, { ...request(c), units: c.get("units") });
    if (page.kind === "not_found") return planGone(c);
    if (page.kind === "forbidden") return c.redirect(`/p/${request(c).planId}`, 303);
    c.header("cache-control", "private, no-store");
    const { participants, interested, removed } = page.people;
    return c.render(
      <DeleteConfirm
        t={c.get("t")}
        planId={page.planId}
        title={page.title}
        responseCount={participants.length + interested.length + removed.length}
        keepsTemplate={page.input.keepAsTemplate === "1"}
        csrfToken={c.get("csrfToken")()}
      />,
      { title: c.get("t")("host.deleteHeading", { title: page.title }) },
    );
  });

  app.post("/p/:id/host/delete", async (c) => {
    const result = await deletePlan(planDeps, request(c));
    return afterAction(c, result, `/p/${request(c).planId}`);
  });

  /** "Remove route…" on the host page: a separate form, outside the edit form (decision D10). */
  app.post("/p/:id/host/route/remove", async (c) => {
    const result = await removeRoute(planDeps, request(c));
    return afterAction(c, result, `/p/${request(c).planId}/host?saved`);
  });

  for (const [action, change] of [
    ["remove", removePerson],
    ["restore", restorePerson],
    ["accept", acceptRequest],
    ["reject", rejectRequest],
  ] as const) {
    app.post(`/p/:id/host/people/:responseId/${action}`, async (c) => {
      const result = await change(planDeps, {
        ...request(c),
        responseId: c.req.param("responseId"),
      });
      return afterAction(c, result, `/p/${request(c).planId}/host`);
    });
  }
}
