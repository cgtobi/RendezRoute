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
import { localizeDecimal } from "../views/format.ts";
import { DeleteConfirm, HostPage } from "../views/host-page.tsx";
import { recapWindowParam } from "../views/recap.tsx";
import { MapAssets } from "../views/maps.tsx";
import { ROUTE_TRIM_FIELD } from "../views/route-trim.tsx";
import { deleteRecap } from "../../../../application/recap.ts";
import { removeRoute, setRoute } from "../../../../application/routes.ts";
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
  tooManyRequests,
} from "./shared.tsx";
import { TIME_ZONES } from "./plans.tsx";

export function registerHostRoutes(
  app: Hono<AppEnv>,
  { config, planDeps, geocoder, limits, vapidPublicKey }: RouteDeps,
) {
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
      routeError?: string;
      routeTrim?: string;
    } = {},
  ) => {
    const page = await viewHostPage(planDeps, { ...request(c), units: c.get("units") });
    if (page.kind === "not_found") return planGone(c);
    if (page.kind === "forbidden") return c.redirect(`/p/${request(c).planId}`, 303);
    c.header("cache-control", "private, no-store");
    return c.render(
      <HostPage
        t={c.get("t")}
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
        routeError={form.routeError}
        routeTrim={form.routeTrim ?? ""}
        map={mapSettings(config)}
        placeSearch={geocoder !== undefined}
      />,
      // Map tools exist only in the full edit form.
      { title: c.get("t")("host.heading"), head: page.scope === "all" ? <MapAssets /> : undefined },
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

  app.post("/p/:id/host", async (c) => {
    const body = await readForm(c);
    if (body === undefined) return badRequest(c);
    const values = planInput((field) => formField(body, field));
    const { planId } = request(c);
    const result = await editPlan(planDeps, {
      ...request(c),
      input: values,
      units: c.get("units"),
      confirmDeleteNow: formField(body, "confirmDeleteNow") === "1",
      confirmAcceptPending: Number(formField(body, "confirmAcceptPending")) || undefined,
    });
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
        return render(c, { values, confirmAcceptPending: result.count });
      case "invalid":
        c.status(422);
        return render(c, { values, errors: result.errors });
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
        csrfToken={c.get("csrfToken")()}
      />,
      { title: c.get("t")("host.deleteHeading", { title: page.title }) },
    );
  });

  app.post("/p/:id/host/delete", async (c) => {
    const result = await deletePlan(planDeps, request(c));
    return afterAction(c, result, `/p/${request(c).planId}`);
  });

  app.post("/p/:id/host/route", async (c) => {
    const body = await readForm(c);
    if (body === undefined) return badRequest(c);
    const gpx = await formFile(body, "gpx");
    if (gpx === undefined) return c.redirect(`/p/${request(c).planId}/host`, 303);
    // Every route file counts: parsing it is the costly part (decision I32).
    const allowed = limits.route.take(clientOf(c));
    if (!allowed.ok) return tooManyRequests(c, allowed.retryAfterSeconds);
    const routeTrim = formField(body, ROUTE_TRIM_FIELD);
    const result = await setRoute(planDeps, { ...request(c), gpx, routeTrim });
    if (result.kind === "invalid") {
      c.status(422);
      return render(c, { routeError: result.code, routeTrim });
    }
    return afterAction(c, result, `/p/${request(c).planId}/host?saved`);
  });

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

/** The stored distance with the language's decimal separator, e.g. "12,5" in German (decision I31). */
function localizedInput(input: PlanInput, language: string): PlanInput {
  return { ...input, distanceKm: localizeDecimal(input.distanceKm, language) };
}
