// The dev-only style guide (decision D72): registered only with ALLOW_INSECURE_DEV, on the public
// app and never on the admin listener. Not linked from any page, never indexed or stored.
import type { Hono } from "hono";
import type { AppEnv } from "../app.tsx";
import { StyleGuide } from "../views/styleguide.tsx";
import type { RouteDeps } from "./shared.tsx";

export function registerStyleGuideRoutes(app: Hono<AppEnv>, deps: Pick<RouteDeps, "config">) {
  const { config } = deps;
  app.get("/styleguide", (c) => {
    c.header("x-robots-tag", "noindex");
    c.header("cache-control", "no-store");
    return c.render(
      <StyleGuide
        t={c.get("t")}
        config={config}
        language={c.get("language")}
        units={c.get("units")}
        theme={c.get("theme")}
        csrfToken={c.get("csrfToken")()}
        returnTo="/styleguide"
      />,
      {
        title: "Style guide",
        head: (
          <>
            <meta name="robots" content="noindex" />
            <link rel="stylesheet" href="/static/styleguide.css" />
          </>
        ),
        wide: true,
      },
    );
  });
}
