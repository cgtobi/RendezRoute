// Rating the plan (spec 6a, decision D20): save, change or remove one's own rating while the recap
// is open. Errors show the form on its own page, like recap contributions.
import type { Context, Hono } from "hono";
import { viewPlan } from "../../../../application/plans.ts";
import { ratePlan, removeRating } from "../../../../application/ratings.ts";
import type { AppEnv } from "../app.tsx";
import { readDeviceToken } from "../device-cookie.ts";
import { RatingSection } from "../views/rating.tsx";
import { badRequest, formField, planGone, readForm, type RouteDeps } from "./shared.tsx";

export function registerRatingRoutes(app: Hono<AppEnv>, { config, planDeps }: RouteDeps) {
  const request = (c: Context<AppEnv>) => ({
    planId: c.req.param("id") ?? "",
    deviceToken: readDeviceToken(c, config),
  });
  const back = (c: Context<AppEnv>) => c.redirect(`/p/${request(c).planId}#rating`, 303);
  // Like recap actions: a device without the right is sent back to the plan page.
  const denied = (c: Context<AppEnv>, kind: "not_found" | "forbidden") =>
    kind === "not_found" ? planGone(c) : c.redirect(`/p/${request(c).planId}`, 303);

  /** The rating form on its own page, after errors or once the recap has closed. */
  const formPage = async (
    c: Context<AppEnv>,
    form: {
      values?: { value: string; note: string };
      errors?: readonly { field: string; code: string }[];
      notice?: string;
    },
  ) => {
    const result = await viewPlan(planDeps, request(c));
    if (result.kind !== "participant" || result.view.rating === undefined) {
      return c.redirect(`/p/${request(c).planId}`, 303);
    }
    const t = c.get("t");
    c.header("cache-control", "private, no-store");
    return c.render(
      <section class="rating-form">
        <p>
          <a href={`/p/${request(c).planId}#rating`}>{t("rating.back")}</a>
        </p>
        <RatingSection
          t={t}
          planId={request(c).planId}
          // Errors keep the form with what was typed, even if rating closed meanwhile: the next
          // save then says so.
          rating={
            form.errors === undefined
              ? result.view.rating
              : { ...result.view.rating, canRate: true }
          }
          csrfToken={c.get("csrfToken")()}
          {...form}
        />
      </section>,
      { title: t("rating.heading") },
    );
  };

  app.post("/p/:id/rating", async (c) => {
    const body = await readForm(c);
    if (body === undefined) return badRequest(c);
    const values = { value: formField(body, "value"), note: formField(body, "note") };
    const result = await ratePlan(planDeps, { ...request(c), ...values });
    switch (result.kind) {
      case "saved":
        return back(c);
      case "invalid":
        c.status(422);
        return formPage(c, { values, errors: result.errors });
      case "closed":
        c.status(409);
        return formPage(c, { notice: c.get("t")("rating.closedNow") });
      default:
        return denied(c, result.kind);
    }
  });

  app.post("/p/:id/rating/delete", async (c) => {
    const result = await removeRating(planDeps, request(c));
    switch (result.kind) {
      case "removed":
        return back(c);
      case "closed":
        c.status(409);
        return formPage(c, { notice: c.get("t")("rating.closedNow") });
      default:
        return denied(c, result.kind);
    }
  });
}
