// Plan routes (spec 5 features 1 and 3).
import type { Context, Hono } from "hono";
import { createPlan, viewPlan } from "../../../../application/plans.ts";
import { DEFAULT_COLORS } from "../../../../domain/color.ts";
import {
  type FieldError,
  PLAN_INPUT_FIELDS,
  type PlanInput,
} from "../../../../domain/plan-input.ts";
import type { AppEnv } from "../app.tsx";
import { readDeviceToken, setDeviceToken } from "../device-cookie.ts";
import { formatDate } from "../views/format.ts";
import { LinksPage } from "../views/links-page.tsx";
import { PlanForm } from "../views/plan-form.tsx";
import {
  badRequest,
  formField,
  newNonce,
  planGone,
  readForm,
  renderPlanPage,
  type RouteDeps,
  secretLinkHeaders,
} from "./shared.tsx";

const TIME_ZONES = (() => {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
})();

/** A PlanInput with every field taken from `value`. */
const planInput = (value: (field: string) => string): PlanInput =>
  Object.fromEntries(PLAN_INPUT_FIELDS.map((field) => [field, value(field)])) as PlanInput;

export function registerPlanRoutes(app: Hono<AppEnv>, { config, planDeps }: RouteDeps) {
  const emptyForm = (): PlanInput => ({
    ...planInput(() => ""),
    activity: "run",
    timeZone: config.defaultTimezone,
    dropPolicy: "no_drop",
    primaryColor: DEFAULT_COLORS.primary,
    secondaryColor: DEFAULT_COLORS.secondary,
  });

  const renderForm = (
    c: Context<AppEnv>,
    values: PlanInput,
    errors: readonly FieldError[],
    nonce: string,
  ) =>
    c.render(
      <PlanForm
        t={c.get("t")}
        values={values}
        errors={errors}
        csrfToken={c.get("csrfToken")()}
        nonce={nonce}
        timeZones={TIME_ZONES}
        maxRetentionDays={config.maxRetentionDays}
      />,
      { title: c.get("t")("form.heading") },
    );

  app.get("/new", (c) => renderForm(c, emptyForm(), [], newNonce()));

  app.post("/new", async (c) => {
    const body = await readForm(c);
    if (body === undefined) return badRequest(c);
    const values = planInput((field) => formField(body, field));

    const result = await createPlan(planDeps, {
      input: values,
      units: "metric",
      language: c.get("language"),
      creationNonce: formField(body, "nonce"),
      deviceToken: readDeviceToken(c, config),
    });

    switch (result.kind) {
      case "bad_request":
        return badRequest(c);
      case "duplicate":
        return c.redirect(`/p/${result.planId}`, 303);
      case "invalid":
        c.status(422);
        return renderForm(c, values, result.errors, formField(body, "nonce"));
      case "created": {
        if (result.newDeviceToken !== undefined) setDeviceToken(c, config, result.newDeviceToken);
        secretLinkHeaders(c);
        const planPath = `/p/${result.planId}`;
        return c.render(
          <LinksPage
            t={c.get("t")}
            planUrl={new URL(planPath, config.baseUrl).href}
            planPath={planPath}
            hostUrl={new URL(`/a/${result.hostToken}`, config.baseUrl).href}
            deletion={formatDate(result.deleteAt, result.timeZone, c.get("language"))}
          />,
          { title: c.get("t")("links.heading") },
        );
      }
    }
  });

  app.get("/p/:id", async (c) => {
    const result = await viewPlan(planDeps, {
      planId: c.req.param("id"),
      deviceToken: readDeviceToken(c, config),
    });
    return result.kind === "not_found" ? planGone(c) : renderPlanPage(c, result);
  });
}
