// Responding and the manage page (spec 5 features 5 and 6).
import type { Context, Hono } from "hono";
import { viewPlan } from "../../../../application/plans.ts";
import { BackLink } from "../views/back-link.tsx";
import {
  respond,
  updateMyResponse,
  viewMyResponse,
  withdrawMyResponse,
} from "../../../../application/responses.ts";
import type { AppEnv } from "../app.tsx";
import { readDeviceToken, setDeviceToken } from "../device-cookie.ts";
import { ManagePage } from "../views/manage-page.tsx";
import { emailProps, registerEmailForms } from "./email.tsx";
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
  newNonce,
  signedOutCount,
} from "./shared.tsx";
import { linkEmailProps } from "./link-tools.tsx";

export function registerResponseRoutes(app: Hono<AppEnv>, deps: RouteDeps) {
  const { config, planDeps, limits, vapidPublicKey } = deps;
  const message = (
    c: Context<AppEnv>,
    planId: string,
    key: "respond.closed" | "respond.blocked",
    status: 403 | 409,
  ) => {
    c.status(status);
    return c.render(
      <>
        <BackLink href={`/p/${planId}`} label={c.get("t")("responded.back")} />
        <h1>{c.get("t")(key)}</h1>
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
      requestNote: formField(body, "requestNote"),
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
        const codeFor = (field: string) => result.errors.find((e) => e.field === field)?.code;
        return renderPlanPage(c, deps, view, {
          displayName: formField(body, "displayName"),
          requestNote: formField(body, "requestNote"),
          errorCode: codeFor("displayName"),
          noteErrorCode: codeFor("requestNote"),
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
      email?: { value: string; error: string } | undefined;
    } = {},
  ) => {
    const deviceToken = readDeviceToken(c, config);
    const result = await viewMyResponse(planDeps, { planId, deviceToken });
    if (result.kind === "not_found") return c.redirect(`/p/${planId}`, 303);
    const email = await emailProps(
      planDeps,
      { planId, deviceToken, role: "responder" },
      `/p/${planId}/me`,
      form.email,
    );
    c.header("cache-control", "private, no-cache");
    return c.render(
      <ManagePage
        t={c.get("t")}
        planId={planId}
        planTitle={result.planTitle}
        response={result.response}
        canChange={result.canChange}
        choices={result.choices}
        push={{ endpoint: `/p/${planId}/me/notifications`, vapidPublicKey }}
        csrfToken={c.get("csrfToken")()}
        displayName={form.displayName ?? result.response.displayName}
        errorCode={form.errorCode}
        notice={form.notice}
        signedOut={signedOutCount(c)}
        linkEmail={await linkEmailProps(c, planDeps, {
          kind: "manage",
          id: planId,
          deviceToken: readDeviceToken(c, config),
        })}
        linkNonce={newNonce()}
        email={email}
      />,
      { title: result.planTitle },
    );
  };

  app.get("/p/:id/me", (c) => renderManagePage(c, c.req.param("id")));

  registerEmailForms(app, deps, {
    role: "responder",
    base: "/p/:id/me",
    rerender: (c, email) => renderManagePage(c, c.req.param("id") ?? "", { email }),
  });

  app.post("/p/:id/me", async (c) => {
    const planId = c.req.param("id");
    const body = await readForm(c);
    if (body === undefined) return badRequest(c);
    // A switch to joined or requested notifies the host, so it counts like a new response
    // (spec 3.11); the token comes back for any other save, and renaming works without one.
    const client = clientOf(c);
    const allowed = limits.respond.take(client);
    const result = await updateMyResponse(planDeps, {
      planId,
      deviceToken: readDeviceToken(c, config),
      choice: formField(body, "choice"),
      displayName: formField(body, "displayName"),
      mayNotifyHost: allowed.ok,
    });
    if (allowed.ok && (result.kind !== "updated" || !result.notifiedHost)) {
      limits.respond.refund(client);
    }
    switch (result.kind) {
      case "limited":
        return tooManyRequests(c, allowed.ok ? 1 : allowed.retryAfterSeconds);
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
