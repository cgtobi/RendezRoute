// Host page routes (spec 5 features 7–9).
import type { Context, Hono } from "hono";
import {
  cancelPlan,
  deletePlan,
  editPlan,
  removePerson,
  restorePerson,
  viewHostPage,
} from "../../../../application/host.ts";
import type { FieldError, PlanInput } from "../../../../domain/plan-input.ts";
import type { AppEnv } from "../app.tsx";
import { readDeviceToken } from "../device-cookie.ts";
import { DeleteConfirm, HostPage } from "../views/host-page.tsx";
import { badRequest, formField, planGone, planInput, readForm, type RouteDeps } from "./shared.tsx";
import { TIME_ZONES } from "./plans.tsx";

export function registerHostRoutes(app: Hono<AppEnv>, { config, planDeps }: RouteDeps) {
  const request = (c: Context<AppEnv>) => ({
    planId: c.req.param("id") ?? "",
    deviceToken: readDeviceToken(c, config),
  });

  const render = async (
    c: Context<AppEnv>,
    form: { values?: PlanInput; errors?: readonly FieldError[]; confirmDeleteNow?: boolean } = {},
  ) => {
    const page = await viewHostPage(planDeps, request(c));
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
        people={page.people}
        values={form.values ?? page.input}
        errors={form.errors ?? []}
        csrfToken={c.get("csrfToken")()}
        timeZones={TIME_ZONES}
        maxRetentionDays={config.maxRetentionDays}
        saved={c.req.query("saved") !== undefined}
        confirmDeleteNow={form.confirmDeleteNow ?? false}
      />,
      { title: c.get("t")("host.heading") },
    );
  };

  /** Shared outcome handling for actions that only redirect. */
  const afterAction = (c: Context<AppEnv>, result: { kind: string }, target: string) => {
    if (result.kind === "not_found") return planGone(c);
    if (result.kind === "forbidden") return c.redirect(`/p/${request(c).planId}`, 303);
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
      units: "metric",
      confirmDeleteNow: formField(body, "confirmDeleteNow") === "1",
    });
    switch (result.kind) {
      case "updated":
        return c.redirect(`/p/${planId}/host?saved`, 303);
      case "deleted":
        return c.redirect(`/p/${planId}`, 303);
      case "confirm_delete_now":
        return render(c, { values, confirmDeleteNow: true });
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

  app.get("/p/:id/host/delete", async (c) => {
    const page = await viewHostPage(planDeps, request(c));
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

  for (const [action, change] of [
    ["remove", removePerson],
    ["restore", restorePerson],
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
