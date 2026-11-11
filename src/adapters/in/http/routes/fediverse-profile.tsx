// What browsers see of actors (spec 7 ActivityPub; decisions D36, D37): a poster's profile page at
// /@handle, and an actor's own address (/actors/<id>, which ActivityPub clients get from Fedify)
// sent on to it; a retired actor is gone, the instance actor is the home page.
import type { Hono } from "hono";
import { HANDLE_PATTERN } from "../../../../domain/actor.ts";
import { posterActor, viewProfilePage } from "../../../../application/fediverse-profile.ts";
import { INSTANCE_ACTOR } from "../../../../application/following.ts";
import type { PlanDeps } from "../../../../application/plans.ts";
import type { IdentityRepository } from "../../../../application/ports.ts";
import type { Config } from "../../../../config.ts";
import type { AppEnv } from "../app.tsx";
import { ProfilePage } from "../views/fediverse-profile.tsx";
import { messagePage } from "./shared.tsx";

export function registerProfileRoutes(
  app: Hono<AppEnv>,
  {
    config,
    planDeps,
    identities,
  }: { config: Config; planDeps: PlanDeps; identities: Pick<IdentityRepository, "findById"> },
) {
  const deps = { ...planDeps, identities };

  // Hono matches a parameter only at the start of a segment, so the "@" is part of it here.
  app.get(`/:at{@${HANDLE_PATTERN}}`, async (c) => {
    const t = c.get("t");
    const page = await viewProfilePage(deps, (c.req.param("at") ?? "").slice(1));
    if (page.kind === "not_found") return messagePage(c, 404, t("error.notFound"));
    return c.render(
      <ProfilePage
        t={t}
        language={c.get("language")}
        instanceName={config.instanceName}
        host={config.baseUrl.hostname}
        profile={page}
      />,
      { title: page.displayName ?? page.handle },
    );
  });

  // Browsers following an actor's address; ActivityPub clients were answered by Fedify.
  app.get("/actors/:id", async (c) => {
    const t = c.get("t");
    const id = c.req.param("id");
    if (id === INSTANCE_ACTOR) return c.redirect("/", 303);
    const actor = await posterActor(deps, id);
    if (actor === undefined) return messagePage(c, 404, t("error.notFound"));
    if (actor.kind === "retired") return messagePage(c, 410, t("actorProfile.gone"));
    return c.redirect(`/@${actor.handle}`, 303);
  });
}
