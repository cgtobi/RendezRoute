// The end-to-end clock control (decision D87): `POST /__e2e/clock/advance` with JSON `{ "ms": n }`
// moves the server clock forward and answers `{ "now": ISO }`. Registered by the composition root
// only when E2E_CLOCK_CONTROL is on, which the configuration allows only with ALLOW_INSECURE_DEV;
// otherwise the path is as unknown as any other. It sits before the CSRF check, as the tests have
// no session, so it insists on a JSON body: a form on another site cannot send one.
import type { Hono } from "hono";
import type { ControllableClock } from "../../../out/controllable-clock.ts";
import type { AppEnv } from "../app.tsx";

export const CLOCK_ADVANCE_PATH = "/__e2e/clock/advance";

export function registerClockControlRoute(app: Hono<AppEnv>, clock: ControllableClock): void {
  app.post(CLOCK_ADVANCE_PATH, async (c) => {
    c.header("cache-control", "no-store");
    if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return c.json({ error: "json_required" }, 415);
    }
    const body: unknown = await c.req.json().catch(() => undefined);
    const ms =
      typeof body === "object" && body !== null ? (body as { ms?: unknown }).ms : undefined;
    if (typeof ms !== "number") return c.json({ error: "invalid" }, 400);
    const advanced = clock.advance(ms);
    if (!advanced.ok) return c.json({ error: advanced.error }, 400);
    return c.json({ now: advanced.value.toISOString() });
  });
}
