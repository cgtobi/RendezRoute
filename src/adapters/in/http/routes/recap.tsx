// Recap contributions (spec 6 feature 5, decision I42): add, edit, delete own, hide as host.
import type { Context, Hono } from "hono";
import {
  addContribution,
  deleteContribution,
  editContribution,
  setContributionHidden,
  viewOwnContribution,
} from "../../../../application/recap.ts";
import { CONTRIBUTION_LIMITS } from "../../../../domain/recap.ts";
import type { AppEnv } from "../app.tsx";
import { readDeviceToken } from "../device-cookie.ts";
import { ContributionForm } from "../views/recap.tsx";
import {
  badRequest,
  clientOf,
  formField,
  planGone,
  readForm,
  type RouteDeps,
  tooManyRequests,
} from "./shared.tsx";
import { BackLink } from "../views/back-link.tsx";

export function registerRecapRoutes(app: Hono<AppEnv>, { config, planDeps, limits }: RouteDeps) {
  const request = (c: Context<AppEnv>) => ({
    planId: c.req.param("id") ?? "",
    deviceToken: readDeviceToken(c, config),
  });
  const contribution = (c: Context<AppEnv>) => ({
    ...request(c),
    contributionId: c.req.param("contributionId") ?? "",
  });
  const back = (c: Context<AppEnv>) => c.redirect(`/p/${request(c).planId}#recap`, 303);
  // Like host actions: a device without the right is sent back to the plan page.
  const denied = (c: Context<AppEnv>, kind: "not_found" | "forbidden") =>
    kind === "not_found" ? planGone(c) : c.redirect(`/p/${request(c).planId}`, 303);

  /** The contribution form on its own page: after errors, or for editing. */
  const formPage = (
    c: Context<AppEnv>,
    form: {
      action: string;
      heading: string;
      submit: string;
      values: { body: string; linkUrl: string };
      errors?: readonly { field: string; code: string }[];
      notice?: string;
    },
  ) => {
    const t = c.get("t");
    c.header("cache-control", "private, no-store");
    return c.render(
      <section class="recap-form">
        <BackLink href={`/p/${request(c).planId}#recap`} label={t("recap.back")} />
        <ContributionForm
          t={t}
          placement="page"
          csrfToken={c.get("csrfToken")()}
          errors={form.errors ?? []}
          {...form}
        />
      </section>,
      { title: form.heading },
    );
  };

  /** The form for editing one's own contribution. */
  const editForm = (c: Context<AppEnv>, values: { body: string; linkUrl: string }) => ({
    action: `/p/${request(c).planId}/recap/${contribution(c).contributionId}`,
    heading: c.get("t")("recap.editHeading"),
    submit: c.get("t")("recap.save"),
    values,
  });

  app.post("/p/:id/recap", async (c) => {
    const body = await readForm(c);
    if (body === undefined) return badRequest(c);
    const t = c.get("t");
    // Reserved first, given back unless something was added (decision I32).
    const client = clientOf(c);
    const allowed = limits.recap.take(client);
    if (!allowed.ok) return tooManyRequests(c, allowed.retryAfterSeconds);
    const values = { body: formField(body, "body"), linkUrl: formField(body, "linkUrl") };
    const result = await addContribution(planDeps, { ...request(c), ...values });
    if (result.kind !== "added") limits.recap.refund(client);
    const form = {
      action: `/p/${request(c).planId}/recap`,
      heading: t("recap.add"),
      submit: t("recap.submit"),
      values,
    };
    switch (result.kind) {
      case "added":
        return back(c);
      case "invalid":
        c.status(422);
        return formPage(c, { ...form, errors: result.errors });
      case "limit_reached":
        c.status(422);
        return formPage(c, {
          ...form,
          notice: t("recap.limit", { count: CONTRIBUTION_LIMITS.perPerson }),
        });
      case "closed":
        c.status(409);
        return formPage(c, { ...form, notice: t("recap.closedNow") });
      default:
        return denied(c, result.kind);
    }
  });

  app.get("/p/:id/recap/:contributionId/edit", async (c) => {
    const result = await viewOwnContribution(planDeps, contribution(c));
    if (result.kind !== "found") return denied(c, result.kind);
    return formPage(c, editForm(c, { body: result.body, linkUrl: result.linkUrl }));
  });

  app.post("/p/:id/recap/:contributionId", async (c) => {
    const body = await readForm(c);
    if (body === undefined) return badRequest(c);
    const values = { body: formField(body, "body"), linkUrl: formField(body, "linkUrl") };
    const result = await editContribution(planDeps, { ...contribution(c), ...values });
    if (result.kind === "updated") return back(c);
    if (result.kind === "invalid") {
      c.status(422);
      return formPage(c, { ...editForm(c, values), errors: result.errors });
    }
    return denied(c, result.kind);
  });

  app.post("/p/:id/recap/:contributionId/delete", async (c) => {
    const result = await deleteContribution(planDeps, contribution(c));
    return result.kind === "deleted" ? back(c) : denied(c, result.kind);
  });

  for (const [action, hidden] of [
    ["hide", true],
    ["show", false],
  ] as const) {
    app.post(`/p/:id/recap/:contributionId/${action}`, async (c) => {
      const result = await setContributionHidden(planDeps, { ...contribution(c), hidden });
      return result.kind === "updated" ? back(c) : denied(c, result.kind);
    });
  }
}
