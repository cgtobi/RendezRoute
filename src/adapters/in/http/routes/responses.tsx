// Responding and the manage page (spec 5 features 5 and 6).
import type { Context, Hono } from "hono";
import { viewPlan } from "../../../../application/plans.ts";
import {
  respond,
  updateMyResponse,
  viewMyResponse,
  withdrawMyResponse,
} from "../../../../application/responses.ts";
import type { AppEnv } from "../app.tsx";
import { readDeviceToken, setDeviceToken } from "../device-cookie.ts";
import { ManagePage } from "../views/manage-page.tsx";
import { formatDate } from "../views/format.ts";
import { RespondedPage } from "../views/responded-page.tsx";
import {
  badRequest,
  formField,
  planGone,
  readForm,
  renderPlanPage,
  type RouteDeps,
  clientOf,
  tooManyRequests,
  secretLinkHeaders,
} from "./shared.tsx";

export function registerResponseRoutes(app: Hono<AppEnv>, { config, planDeps, limits }: RouteDeps) {
  const message = (
    c: Context<AppEnv>,
    planId: string,
    key: "respond.closed" | "respond.blocked",
    status: 403 | 409,
  ) => {
    c.status(status);
    return c.render(
      <>
        <p class="notice">{c.get("t")(key)}</p>
        <p>
          <a href={`/p/${planId}`}>{c.get("t")("responded.back")}</a>
        </p>
      </>,
      { title: c.get("t")(key) },
    );
  };

  app.post("/p/:id/respond", async (c) => {
    const planId = c.req.param("id");
    const body = await readForm(c);
    if (body === undefined) return badRequest(c);
    const deviceToken = readDeviceToken(c, config);
    // Reserved before any work and given back unless a response is created (spec 5 feature 12).
    const client = clientOf(c);
    const allowed = limits.respond.take(client);
    if (!allowed.ok) return tooManyRequests(c, allowed.retryAfterSeconds);
    const result = await respond(planDeps, {
      planId,
      choice: formField(body, "choice"),
      displayName: formField(body, "displayName"),
      language: c.get("language"),
      creationNonce: formField(body, "nonce"),
      deviceToken,
    });
    if (result.kind !== "created") limits.respond.refund(client);

    switch (result.kind) {
      case "created": {
        if (result.newDeviceToken !== undefined) setDeviceToken(c, config, result.newDeviceToken);
        secretLinkHeaders(c);
        return c.render(
          <RespondedPage
            t={c.get("t")}
            manageUrl={new URL(`/m/${result.manageToken}`, config.baseUrl).href}
            planPath={`/p/${result.planId}`}
            deletion={formatDate(result.deleteAt, result.timeZone, c.get("language"))}
          />,
          { title: c.get("t")("responded.heading") },
        );
      }
      case "duplicate":
      case "is_host":
        return c.redirect(`/p/${planId}`, 303);
      case "already_responded":
        return c.redirect(`/p/${planId}/me`, 303);
      case "blocked":
        return message(c, planId, "respond.blocked", 403);
      case "closed":
        return message(c, planId, "respond.closed", 409);
      case "not_found":
        return planGone(c);
      case "bad_request":
        return badRequest(c);
      case "invalid": {
        const view = await viewPlan(planDeps, { planId, deviceToken });
        if (view.kind === "not_found") return planGone(c);
        c.status(422);
        return renderPlanPage(c, config, view, {
          displayName: formField(body, "displayName"),
          errorCode: result.errors[0]?.code,
          nonce: formField(body, "nonce"),
        });
      }
    }
  });

  const renderManagePage = async (
    c: Context<AppEnv>,
    planId: string,
    form: {
      displayName?: string | undefined;
      errorCode?: string | undefined;
      notice?: string | undefined;
    } = {},
  ) => {
    const result = await viewMyResponse(planDeps, {
      planId,
      deviceToken: readDeviceToken(c, config),
    });
    if (result.kind === "not_found") return c.redirect(`/p/${planId}`, 303);
    c.header("cache-control", "private, no-cache");
    return c.render(
      <ManagePage
        t={c.get("t")}
        planId={planId}
        planTitle={result.planTitle}
        response={result.response}
        canChange={result.canChange}
        csrfToken={c.get("csrfToken")()}
        displayName={form.displayName ?? result.response.displayName}
        errorCode={form.errorCode}
        notice={form.notice}
      />,
      { title: result.planTitle },
    );
  };

  app.get("/p/:id/me", (c) => renderManagePage(c, c.req.param("id")));

  app.post("/p/:id/me", async (c) => {
    const planId = c.req.param("id");
    const body = await readForm(c);
    if (body === undefined) return badRequest(c);
    const result = await updateMyResponse(planDeps, {
      planId,
      deviceToken: readDeviceToken(c, config),
      choice: formField(body, "choice"),
      displayName: formField(body, "displayName"),
    });
    switch (result.kind) {
      case "updated":
        return c.redirect(`/p/${planId}/me`, 303);
      case "not_found":
        return c.redirect(`/p/${planId}`, 303);
      case "bad_request":
        return badRequest(c);
      case "invalid":
        c.status(422);
        return renderManagePage(c, planId, {
          displayName: formField(body, "displayName"),
          errorCode: result.errors[0]?.code,
        });
      case "closed":
        c.status(409);
        return renderManagePage(c, planId, { notice: c.get("t")("respond.closed") });
      case "blocked":
        c.status(403);
        return renderManagePage(c, planId, { notice: c.get("t")("respond.blocked") });
    }
  });

  app.post("/p/:id/me/withdraw", async (c) => {
    const planId = c.req.param("id");
    await withdrawMyResponse(planDeps, { planId, deviceToken: readDeviceToken(c, config) });
    return c.redirect(`/p/${planId}`, 303);
  });
}
