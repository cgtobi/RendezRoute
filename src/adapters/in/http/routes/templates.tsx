// Repeatable templates (spec 3.10 Templates, decision I43): "Save as template" on the host page,
// and the template page with Repeat, Edit and Delete for the devices linked to a template.
import type { Context, Hono } from "hono";
import {
  deleteTemplate,
  editTemplate,
  removeTemplateRoute,
  repeatTemplate,
  saveAsTemplate,
  viewTemplate,
} from "../../../../application/templates.ts";
import type { FieldError, PlanInput } from "../../../../domain/plan-input.ts";
import { templateToInput } from "../../../../domain/template.ts";
import type { AppEnv } from "../app.tsx";
import { readDeviceToken, setDeviceToken } from "../device-cookie.ts";
import { formatDate } from "../views/format.ts";
import { LinksPage } from "../views/links-page.tsx";
import { MapAssets } from "../views/maps.tsx";
import { BackLink } from "../views/back-link.tsx";
import { PlanForm } from "../views/plan-form.tsx";
import { TemplatePage, TemplateSavedPage } from "../views/templates.tsx";
import {
  badRequest,
  clientOf,
  formField,
  postingClosed,
  localizedInput,
  mapSettings,
  newNonce,
  planGone,
  planInput,
  templateGone,
  readForm,
  type RouteDeps,
  secretLinkHeaders,
  TIME_ZONES,
  tooManyRequests,
  signedOutCount,
  visibilityChoice,
} from "./shared.tsx";
import { linkEmailProps } from "./link-tools.tsx";

export function registerTemplateRoutes(app: Hono<AppEnv>, deps: RouteDeps) {
  const { config, planDeps, geocoder, limits } = deps;
  const request = (c: Context<AppEnv>) => ({
    templateId: c.req.param("id") ?? "",
    deviceToken: readDeviceToken(c, config),
  });
  const base = (c: Context<AppEnv>) => `/templates/${request(c).templateId}`;

  const renderPage = async (
    c: Context<AppEnv>,
    repeat: { date: string; time?: string; errors: readonly FieldError[] } = {
      date: "",
      errors: [],
    },
  ) => {
    const result = await viewTemplate(planDeps, request(c));
    if (result.kind !== "found") return templateGone(c);
    c.header("cache-control", "private, no-store");
    c.header("x-robots-tag", "noindex");
    return c.render(
      <TemplatePage
        t={c.get("t")}
        language={c.get("language")}
        units={c.get("units")}
        template={result.template}
        csrfToken={c.get("csrfToken")()}
        nonce={newNonce()}
        repeat={{ ...repeat, time: repeat.time ?? result.template.startTime }}
        postingClosed={
          result.postingNeed === undefined
            ? undefined
            : { requirement: result.postingNeed, contactEmail: config.contactEmail }
        }
        saved={c.req.query("saved") !== undefined}
        signedOut={signedOutCount(c)}
        linkEmail={await linkEmailProps(c, planDeps, {
          kind: "template",
          id: request(c).templateId,
          deviceToken: readDeviceToken(c, config),
        })}
        linkNonce={newNonce()}
      />,
      { title: result.template.title },
    );
  };

  const renderEditForm = async (
    c: Context<AppEnv>,
    form: { values?: PlanInput; errors?: readonly FieldError[]; notice?: string } = {},
  ) => {
    const result = await viewTemplate(planDeps, request(c));
    if (result.kind !== "found") return templateGone(c);
    const t = c.get("t");
    c.header("cache-control", "private, no-store");
    return c.render(
      <section class="host">
        <BackLink href={base(c)} label={t("template.back")} />
        <PlanForm
          t={t}
          values={
            form.values ??
            localizedInput(templateToInput(result.template, c.get("units")), c.get("language"))
          }
          errors={form.errors ?? []}
          csrfToken={c.get("csrfToken")()}
          nonce={undefined}
          timeZones={TIME_ZONES}
          maxRetentionDays={config.maxRetentionDays}
          action={`${base(c)}/edit`}
          heading={t("template.editHeading")}
          submitLabel={t("template.save")}
          withGpx={false}
          map={mapSettings(config)}
          placeSearch={geocoder !== undefined}
          routeTrim=""
          units={c.get("units")}
          forTemplate
          notice={form.notice}
          visibility={visibilityChoice(config, result.visibility)}
        />
      </section>,
      { title: t("template.editHeading"), head: <MapAssets /> },
    );
  };

  /** "Save as template" from the host page: shows the new template link once. */
  app.post("/p/:id/host/template", async (c) => {
    const body = await readForm(c);
    if (body === undefined) return badRequest(c);
    const client = clientOf(c);
    const allowed = limits.create.take(client);
    if (!allowed.ok) return tooManyRequests(c, allowed.retryAfterSeconds);
    const planId = c.req.param("id");
    const result = await saveAsTemplate(planDeps, {
      planId,
      deviceToken: readDeviceToken(c, config),
      includePrivate: formField(body, "includePrivate") === "1",
      creationNonce: formField(body, "nonce"),
    });
    if (result.kind !== "saved") limits.create.refund(client);
    switch (result.kind) {
      case "not_found":
        return planGone(c);
      case "forbidden":
        return c.redirect(`/p/${planId}`, 303);
      case "bad_request":
        return badRequest(c);
      case "duplicate":
        // The form was sent again: its link was shown once already.
        return c.redirect(`/templates/${result.templateId}`, 303);
    }
    secretLinkHeaders(c);
    const templatePath = `/templates/${result.templateId}`;
    return c.render(
      <TemplateSavedPage
        t={c.get("t")}
        title={result.title}
        templateUrl={new URL(`/t/${result.hostToken}`, config.baseUrl).href}
        templatePath={templatePath}
      />,
      { title: c.get("t")("template.savedHeading") },
    );
  });

  app.get("/templates/:id", (c) => renderPage(c));

  app.post("/templates/:id/repeat", async (c) => {
    const body = await readForm(c);
    if (body === undefined) return badRequest(c);
    // Repeating creates a plan: the same limit, reserved first and given back unless created.
    const client = clientOf(c);
    const allowed = limits.create.take(client);
    if (!allowed.ok) return tooManyRequests(c, allowed.retryAfterSeconds);
    const when = { date: formField(body, "date"), time: formField(body, "time") };
    const result = await repeatTemplate(planDeps, {
      ...request(c),
      ...when,
      units: c.get("units"),
      creationNonce: formField(body, "nonce"),
    });
    if (result.kind !== "created") limits.create.refund(client);
    switch (result.kind) {
      case "not_found":
      case "forbidden":
        return templateGone(c);
      case "bad_request":
        return badRequest(c);
      case "not_allowed":
        return postingClosed(c, config, result.needs, 403);
      case "duplicate":
        return c.redirect(`/p/${result.planId}`, 303);
      case "invalid":
        c.status(422);
        return renderPage(c, { ...when, errors: result.errors });
      case "needs_edit":
        c.status(422);
        return renderEditForm(c, {
          errors: result.errors,
          notice: c.get("t")("template.needsEdit"),
        });
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
            recapWindowShortened={undefined}
            adjustments={result.adjustments}
          />,
          { title: c.get("t")("links.heading") },
        );
      }
    }
  });

  app.get("/templates/:id/edit", (c) => renderEditForm(c));

  app.post("/templates/:id/edit", async (c) => {
    const body = await readForm(c);
    if (body === undefined) return badRequest(c);
    const values = planInput((field) => formField(body, field));
    const result = await editTemplate(planDeps, {
      ...request(c),
      input: values,
      units: c.get("units"),
    });
    switch (result.kind) {
      case "updated":
        return c.redirect(`${base(c)}?saved`, 303);
      case "invalid":
        c.status(422);
        return renderEditForm(c, { values, errors: result.errors });
      default:
        return templateGone(c);
    }
  });

  app.post("/templates/:id/route/remove", async (c) => {
    const result = await removeTemplateRoute(planDeps, request(c));
    return result.kind === "removed" ? c.redirect(`${base(c)}?saved`, 303) : templateGone(c);
  });

  app.post("/templates/:id/delete", async (c) => {
    const result = await deleteTemplate(planDeps, request(c));
    return result.kind === "deleted" ? c.redirect("/", 303) : templateGone(c);
  });
}
