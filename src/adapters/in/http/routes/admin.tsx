// The instance admin pages (spec 7 Moderation, 3.8 URLs): login through `AdminAuth`, then a page to
// find and delete any plan, resolve reports and (with POSTING_MODE=invite) manage invite links.
// Only relative URLs, so the pages work under any path prefix (Home Assistant Ingress later);
// registered only when admin authentication is configured.
import type { Context, Hono } from "hono";
import {
  type AdminDeps,
  adminOverview,
  deletePlanAsAdmin,
  isAdmin,
  logInAsAdmin,
  resolveReport,
  viewPlanAsAdmin,
} from "../../../../application/admin.ts";
import { createInvite, listInvites, revokeInvite } from "../../../../application/posting.ts";
import type { Config } from "../../../../config.ts";
import type { InviteError, InviteInput } from "../../../../domain/invite.ts";
import { adminSessionOf, endAdminSession, setAdminSession } from "../admin-session.ts";
import type { AppEnv } from "../app.tsx";
import type { RateLimits } from "../rate-limit.ts";
import { AdminHome, AdminLogin, AdminPlan, InviteCreated } from "../views/admin.tsx";
import {
  adminRoot,
  badRequest,
  clientOf,
  formField,
  newNonce,
  readForm,
  secretLinkHeaders,
  tooManyRequests,
} from "./shared.tsx";

const PLAN_ID = /^[A-Za-z0-9_-]{22}$/;
/** Report and invite IDs (UUIDv7). */
const ROW_ID = /^[A-Za-z0-9-]{1,64}$/;
const PLAN_LINK = /\/p\/([A-Za-z0-9_-]{22})(?:[/?#]|$)/;

/** A plan ID from a pasted plan link or a bare ID. */
export function planIdFrom(input: string): string | undefined {
  const value = input.trim();
  if (PLAN_ID.test(value)) return value;
  return PLAN_LINK.exec(value)?.[1];
}

export function registerAdminRoutes(
  app: Hono<AppEnv>,
  deps: { config: Config; adminDeps: AdminDeps; limits: RateLimits },
) {
  const { config, adminDeps, limits } = deps;
  const adminDir = (c: Context<AppEnv>) => `${adminRoot(c.req.path)}admin/`;
  const session = (c: Context<AppEnv>) => adminSessionOf(c, config);
  const toLogin = (c: Context<AppEnv>) => c.redirect(`${adminDir(c)}login`, 303);
  const render = (c: Context<AppEnv>, title: string, body: string | Promise<string>) => {
    c.header("cache-control", "no-store");
    c.header("x-robots-tag", "noindex");
    return c.render(body, { title, pathBase: adminRoot(c.req.path) });
  };

  app.get("/admin", (c) => c.redirect("admin/", 303));

  // Every admin page but the login needs the admin session.
  app.use("/admin/*", async (c, next) => {
    if (c.req.path === "/admin/login") return next();
    if (!isAdmin(adminDeps, { session: session(c) })) return toLogin(c);
    return next();
  });

  app.get("/admin/login", (c) => {
    if (isAdmin(adminDeps, { session: session(c) })) return c.redirect(adminDir(c), 303);
    const t = c.get("t");
    return render(
      c,
      t("admin.loginHeading"),
      <AdminLogin t={t} csrfToken={c.get("csrfToken")()} failed={false} />,
    );
  });

  app.post("/admin/login", async (c) => {
    const body = await readForm(c);
    if (body === undefined) return badRequest(c);
    // Every attempt counts, against guessing the token.
    const allowed = limits.adminLogin.take(clientOf(c));
    if (!allowed.ok) return tooManyRequests(c, allowed.retryAfterSeconds);
    const result = logInAsAdmin(adminDeps, { token: formField(body, "token") });
    if (result.kind === "refused") {
      const t = c.get("t");
      c.status(401);
      return render(
        c,
        t("admin.loginHeading"),
        <AdminLogin t={t} csrfToken={c.get("csrfToken")()} failed />,
      );
    }
    setAdminSession(c, config, result.session, adminDeps.clock.now());
    return c.redirect(adminDir(c), 303);
  });

  app.post("/admin/logout", (c) => {
    endAdminSession(c, config);
    return toLogin(c);
  });

  type NotFound = "plan" | "report" | "invite";
  /** The admin's home with the open reports and invites; also the page for something not found. */
  const home = async (
    c: Context<AppEnv>,
    state: {
      deleted: boolean;
      notFound: NotFound | undefined;
      status?: 200 | 404 | 422;
      inviteForm?: { values: InviteInput; errors: InviteError[] };
    },
  ) => {
    const overview = await adminOverview(adminDeps, { session: session(c) });
    if (overview.kind === "not_admin") return toLogin(c);
    const invites =
      config.postingMode === "invite"
        ? await listInvites(adminDeps, { session: session(c) })
        : undefined;
    if (invites?.kind === "not_admin") return toLogin(c);
    const t = c.get("t");
    c.status(state.status ?? 200);
    return render(
      c,
      t("admin.title"),
      <AdminHome
        t={t}
        csrfToken={c.get("csrfToken")()}
        adminDir={adminDir(c)}
        deleted={state.deleted}
        notFound={state.notFound}
        openReports={overview.openReports}
        invites={
          invites === undefined
            ? undefined
            : {
                language: c.get("language"),
                timeZone: config.defaultTimezone,
                list: invites.invites,
                nonce: newNonce(),
                values: state.inviteForm?.values ?? { expiresOn: "", maxUses: "" },
                errors: state.inviteForm?.errors ?? [],
              }
        }
      />,
    );
  };
  const notFound = (c: Context<AppEnv>, status: 404 | 422, what: NotFound = "plan") =>
    home(c, { deleted: false, notFound: what, status });

  app.get("/admin/", (c) =>
    home(c, { deleted: c.req.query("deleted") !== undefined, notFound: undefined }),
  );

  app.post("/admin/plans", async (c) => {
    const body = await readForm(c);
    if (body === undefined) return badRequest(c);
    const planId = planIdFrom(formField(body, "plan"));
    if (planId !== undefined) return c.redirect(`${adminDir(c)}plans/${planId}`, 303);
    return notFound(c, 422);
  });

  app.get("/admin/plans/:id", async (c) => {
    const planId = c.req.param("id");
    if (!PLAN_ID.test(planId)) return notFound(c, 404);
    const result = await viewPlanAsAdmin(adminDeps, { planId, session: session(c) });
    if (result.kind === "not_admin") return toLogin(c);
    if (result.kind === "not_found") return notFound(c, 404);
    const t = c.get("t");
    return render(
      c,
      t("admin.planHeading", { title: result.view.title }),
      <AdminPlan
        t={t}
        language={c.get("language")}
        csrfToken={c.get("csrfToken")()}
        adminDir={adminDir(c)}
        view={result.view}
        reports={result.reports}
      />,
    );
  });

  app.post("/admin/plans/:id/delete", async (c) => {
    const planId = c.req.param("id");
    if (!PLAN_ID.test(planId)) return notFound(c, 404);
    const result = await deletePlanAsAdmin(adminDeps, { planId, session: session(c) });
    if (result.kind === "not_admin") return toLogin(c);
    if (result.kind === "not_found") return notFound(c, 404);
    return c.redirect(`${adminDir(c)}?deleted`, 303);
  });

  app.post("/admin/reports/:id/resolve", async (c) => {
    const reportId = c.req.param("id");
    if (!ROW_ID.test(reportId)) return notFound(c, 404, "report");
    const result = await resolveReport(adminDeps, { reportId, session: session(c) });
    if (result.kind === "not_admin") return toLogin(c);
    if (result.kind === "not_found") return notFound(c, 404, "report");
    return c.redirect(`${adminDir(c)}plans/${result.planId}#reports`, 303);
  });

  if (config.postingMode !== "invite") return;

  app.post("/admin/invites", async (c) => {
    const body = await readForm(c);
    if (body === undefined) return badRequest(c);
    const values: InviteInput = {
      expiresOn: formField(body, "expiresOn"),
      maxUses: formField(body, "maxUses"),
    };
    const result = await createInvite(adminDeps, {
      session: session(c),
      ...values,
      timeZone: config.defaultTimezone,
      nonce: formField(body, "nonce"),
    });
    switch (result.kind) {
      case "not_admin":
        return toLogin(c);
      case "bad_request":
        return badRequest(c);
      case "invalid":
        return home(c, {
          deleted: false,
          notFound: undefined,
          status: 422,
          inviteForm: { values, errors: result.errors },
        });
      // Sent again: the link was shown the first time and cannot be shown again.
      case "duplicate":
        return c.redirect(`${adminDir(c)}#invites`, 303);
      case "created": {
        const t = c.get("t");
        secretLinkHeaders(c);
        return render(
          c,
          t("admin.inviteCreatedHeading"),
          <InviteCreated
            t={t}
            url={new URL(`/i/${result.token}`, config.baseUrl).href}
            adminDir={adminDir(c)}
          />,
        );
      }
    }
  });

  app.post("/admin/invites/:id/revoke", async (c) => {
    const inviteId = c.req.param("id");
    if (!ROW_ID.test(inviteId)) return notFound(c, 404, "invite");
    const result = await revokeInvite(adminDeps, { inviteId, session: session(c) });
    if (result.kind === "not_admin") return toLogin(c);
    if (result.kind === "not_found") return notFound(c, 404, "invite");
    return c.redirect(`${adminDir(c)}#invites`, 303);
  });
}
