// The instance admin pages (spec 7 Moderation, 3.8 URLs): login through `AdminAuth`, then a page to
// find and delete any plan. Only relative URLs, so the pages work under any path prefix (Home
// Assistant Ingress later); registered only when admin authentication is configured.
import type { Context, Hono } from "hono";
import {
  type AdminDeps,
  deletePlanAsAdmin,
  isAdmin,
  logInAsAdmin,
  viewPlanAsAdmin,
} from "../../../../application/admin.ts";
import type { Config } from "../../../../config.ts";
import { adminSessionOf, endAdminSession, setAdminSession } from "../admin-session.ts";
import type { AppEnv } from "../app.tsx";
import type { RateLimits } from "../rate-limit.ts";
import { AdminHome, AdminLogin, AdminPlan } from "../views/admin.tsx";
import { badRequest, clientOf, formField, readForm, tooManyRequests } from "./shared.tsx";

/**
 * The relative way from an admin page back to the app's root: "../" from /admin/ and
 * /admin/login, "../../" from /admin/plans/<id>, and so on.
 */
export function adminRoot(path: string): string {
  if (!path.startsWith("/admin/")) throw new Error(`Not an admin page: ${path}`);
  const depth = path.slice("/admin/".length).split("/").length - 1;
  return "../".repeat(depth + 1);
}

const PLAN_ID = /^[A-Za-z0-9_-]{22}$/;
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

  const notFound = (c: Context<AppEnv>, status: 404 | 422) => {
    const t = c.get("t");
    c.status(status);
    return render(
      c,
      t("admin.title"),
      <AdminHome
        t={t}
        csrfToken={c.get("csrfToken")()}
        adminDir={adminDir(c)}
        deleted={false}
        notFound
      />,
    );
  };

  app.get("/admin/", (c) => {
    const t = c.get("t");
    return render(
      c,
      t("admin.title"),
      <AdminHome
        t={t}
        csrfToken={c.get("csrfToken")()}
        adminDir={adminDir(c)}
        deleted={c.req.query("deleted") !== undefined}
        notFound={false}
      />,
    );
  });

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
}
