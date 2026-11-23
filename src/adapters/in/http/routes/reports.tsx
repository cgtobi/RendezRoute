// Reporting a plan to the instance admin (spec 7 Moderation, decision I47); registered only when
// admin authentication is configured. Rate limited per client; a report that was not stored
// gives its token back.
import type { Context, Hono } from "hono";
import { reportForm, reportPlan } from "../../../../application/reports.ts";
import type { AppEnv } from "../app.tsx";
import { readDeviceToken } from "../device-cookie.ts";
import { ReportForm, ReportSent } from "../views/report.tsx";
import {
  badRequest,
  clientOf,
  newNonce,
  planGone,
  type RouteDeps,
  messagePage,
  tooManyRequests,
} from "./shared.tsx";

/** Form fields with every value of repeated ones (the attached posts' checkboxes). */
async function readReportForm(c: Context<AppEnv>) {
  try {
    const body = await c.req.parseBody({ all: true });
    const one = (name: string) => (typeof body[name] === "string" ? body[name] : "");
    const attach = [body.attach ?? []]
      .flat()
      .filter((value): value is string => typeof value === "string");
    return { reason: one("reason"), details: one("details"), nonce: one("nonce"), attach };
  } catch {
    return undefined;
  }
}

export function registerReportRoutes(app: Hono<AppEnv>, { config, planDeps, limits }: RouteDeps) {
  const request = (c: Context<AppEnv>) => ({
    planId: c.req.param("id") ?? "",
    deviceToken: readDeviceToken(c, config),
  });

  /** The form, empty or with what was sent and its errors. */
  const formPage = async (
    c: Context<AppEnv>,
    sent?: {
      values: { reason: string; details: string; attach: string[] };
      errors: readonly { field: string; code: string }[];
      nonce: string;
    },
  ) => {
    const form = await reportForm(planDeps, request(c));
    if (form.kind === "not_found") return planGone(c);
    const t = c.get("t");
    // The form lists recap posts the device can see: never cached or indexed.
    c.header("cache-control", "private, no-store");
    c.header("x-robots-tag", "noindex");
    return c.render(
      <ReportForm
        t={t}
        planId={request(c).planId}
        planTitle={form.planTitle}
        attachable={form.attachable}
        csrfToken={c.get("csrfToken")()}
        nonce={sent?.nonce ?? newNonce()}
        values={sent?.values}
        errors={sent?.errors}
      />,
      { title: t("report.heading", { title: form.planTitle }) },
    );
  };

  app.get("/p/:id/report", async (c) => {
    if (c.req.query("sent") === undefined) return formPage(c);
    if ((await reportForm(planDeps, request(c))).kind === "not_found") return planGone(c);
    const t = c.get("t");
    c.header("x-robots-tag", "noindex");
    return c.render(<ReportSent t={t} planId={request(c).planId} />, {
      title: t("report.sentTitle"),
    });
  });

  app.post("/p/:id/report", async (c) => {
    const form = await readReportForm(c);
    if (form === undefined) return badRequest(c);
    const client = clientOf(c);
    const allowed = limits.report.take(client);
    if (!allowed.ok) return tooManyRequests(c, allowed.retryAfterSeconds);
    // Per plan, whoever sends them: 10 an hour, like reports from the fediverse (0.19.0).
    const { planId } = request(c);
    const planAllowed = limits.reportPlan.take(planId);
    if (!planAllowed.ok) {
      limits.report.refund(client);
      c.header("retry-after", String(planAllowed.retryAfterSeconds));
      return messagePage(c, 429, c.get("t")("error.reportsBusy"));
    }
    const result = await reportPlan(planDeps, { ...request(c), ...form });
    if (result.kind !== "sent" || !result.created) {
      limits.report.refund(client);
      limits.reportPlan.refund(planId);
    }
    switch (result.kind) {
      case "sent":
        return c.redirect(`/p/${request(c).planId}/report?sent`, 303);
      case "invalid": {
        c.status(422);
        const { nonce, ...values } = form;
        return formPage(c, { values, errors: result.errors, nonce });
      }
      case "bad_request":
        return badRequest(c);
      default:
        return planGone(c);
    }
  });
}
