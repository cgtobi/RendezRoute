// Plan routes (spec 5 features 1 and 3, 3.2 host links).
import { randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import { confirmHostLink, openHostLink } from "../../../../application/host-links.ts";
import { createPlan, type PlanDeps, viewPlan } from "../../../../application/plans.ts";
import { DEFAULT_COLORS } from "../../../../domain/color.ts";
import {
  type FieldError,
  PLAN_INPUT_FIELDS,
  type PlanInput,
} from "../../../../domain/plan-input.ts";
import type { Config } from "../../../../config.ts";
import type { AppEnv } from "../app.tsx";
import { readDeviceToken, setDeviceToken } from "../device-cookie.ts";
import { formatDate } from "../views/format.ts";
import { HostLinkConfirm, HostLinkHead } from "../views/host-link.tsx";
import { LinksPage } from "../views/links-page.tsx";
import { PlanForm } from "../views/plan-form.tsx";
import { PlanPage } from "../views/plan-page.tsx";

const TIME_ZONES = (() => {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
})();

const newNonce = () => randomBytes(16).toString("base64url");

/** A PlanInput with every field taken from `value`. */
const planInput = (value: (field: string) => string): PlanInput =>
  Object.fromEntries(PLAN_INPUT_FIELDS.map((field) => [field, value(field)])) as PlanInput;

/** Parsed form fields, or undefined for a malformed body. */
async function readForm(c: Context): Promise<Record<string, unknown> | undefined> {
  try {
    return await c.req.parseBody();
  } catch {
    return undefined;
  }
}

/** Responses that carry or follow a secret link (spec 3.2, 3.8). */
function secretLinkHeaders(c: Context): void {
  c.header("referrer-policy", "no-referrer");
  c.header("cache-control", "no-store");
}

export function registerPlanRoutes(
  app: Hono<AppEnv>,
  { config, planDeps }: { config: Config; planDeps: PlanDeps },
) {
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

  const notFound = (c: Context<AppEnv>) => {
    c.status(404);
    return c.render(<p class="gone">{c.get("t")("plan.gone")}</p>, {
      title: c.get("t")("plan.gone"),
    });
  };

  app.get("/new", (c) => renderForm(c, emptyForm(), [], newNonce()));

  app.post("/new", async (c) => {
    const body = await readForm(c);
    if (body === undefined) return c.text(c.get("t")("error.badRequest"), 400);
    const field = (name: string) => (typeof body[name] === "string" ? body[name] : "");
    const values = planInput(field);

    const result = await createPlan(planDeps, {
      input: values,
      units: "metric",
      language: c.get("language"),
      creationNonce: field("nonce"),
      deviceToken: readDeviceToken(c, config),
    });

    switch (result.kind) {
      case "bad_request":
        return c.text(c.get("t")("error.badRequest"), 400);
      case "duplicate":
        return c.redirect(`/p/${result.planId}`, 303);
      case "invalid":
        c.status(422);
        return renderForm(c, values, result.errors, field("nonce"));
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
    if (result.kind === "not_found") return notFound(c);
    c.header("cache-control", "private, no-cache");
    return c.render(<PlanPage t={c.get("t")} language={c.get("language")} audience={result} />, {
      title: result.view.title,
    });
  });

  app.get("/a/:token", async (c) => {
    const token = c.req.param("token");
    const result = await openHostLink(planDeps, { token, deviceToken: readDeviceToken(c, config) });
    secretLinkHeaders(c);
    switch (result.kind) {
      case "not_found":
        c.status(404);
        return c.render(<p>{c.get("t")("hostLink.invalid")}</p>, {
          head: <HostLinkHead t={c.get("t")} />,
        });
      case "already_linked":
        return c.redirect(`/p/${result.planId}`, 303);
      case "confirm":
        c.header("x-robots-tag", "noindex");
        return c.render(
          <HostLinkConfirm
            t={c.get("t")}
            title={result.title}
            token={token}
            csrfToken={c.get("csrfToken")()}
          />,
          { title: c.get("t")("hostLink.heading"), head: <HostLinkHead t={c.get("t")} /> },
        );
    }
  });

  app.post("/a", async (c) => {
    const body = await readForm(c);
    if (body === undefined) return c.text(c.get("t")("error.badRequest"), 400);
    const token = typeof body.token === "string" ? body.token : "";
    const result = await confirmHostLink(planDeps, {
      token,
      deviceToken: readDeviceToken(c, config),
    });
    secretLinkHeaders(c);
    if (result.kind === "not_found") {
      c.status(404);
      return c.render(<p>{c.get("t")("hostLink.invalid")}</p>);
    }
    if (result.newDeviceToken !== undefined) setDeviceToken(c, config, result.newDeviceToken);
    return c.redirect(`/p/${result.planId}`, 303);
  });
}
