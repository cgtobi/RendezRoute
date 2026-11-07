// Helpers shared by the plan, response and secret-link routes.
import { randomBytes } from "node:crypto";
import type { Context } from "hono";
import type { PlanDeps } from "../../../../application/plans.ts";
import type { ViewPlanResult } from "../../../../application/plans.ts";
import { PLAN_INPUT_FIELDS, type PlanInput } from "../../../../domain/plan-input.ts";
import type { Config } from "../../../../config.ts";
import type { AppEnv } from "../app.tsx";
import { PlanPage } from "../views/plan-page.tsx";

export interface RouteDeps {
  config: Config;
  planDeps: PlanDeps;
}

/** One-time form value (decision I9). */
export const newNonce = () => randomBytes(16).toString("base64url");

/** Parsed form fields, or undefined for a malformed body. */
export async function readForm(c: Context): Promise<Record<string, unknown> | undefined> {
  try {
    return await c.req.parseBody();
  } catch {
    return undefined;
  }
}

export const formField = (body: Record<string, unknown>, name: string): string =>
  typeof body[name] === "string" ? body[name] : "";

/** The bytes of an uploaded file field, or undefined if none was chosen. */
export async function formFile(
  body: Record<string, unknown>,
  name: string,
): Promise<Uint8Array | undefined> {
  const file = body[name];
  if (!(file instanceof File) || file.size === 0) return undefined;
  return new Uint8Array(await file.arrayBuffer());
}

/** A PlanInput with every field taken from `value`. */
export const planInput = (value: (field: string) => string): PlanInput =>
  Object.fromEntries(PLAN_INPUT_FIELDS.map((field) => [field, value(field)])) as PlanInput;

/** Responses that carry or follow a secret link (spec 3.2, 3.8). */
export function secretLinkHeaders(c: Context): void {
  c.header("referrer-policy", "no-referrer");
  c.header("cache-control", "no-store");
}

export function badRequest(c: Context<AppEnv>) {
  return c.text(c.get("t")("error.badRequest"), 400);
}

export function planGone(c: Context<AppEnv>) {
  c.status(404);
  return c.render(<p class="gone">{c.get("t")("plan.gone")}</p>, {
    title: c.get("t")("plan.gone"),
  });
}

/** Renders a found plan for its audience, with the response form for viewers. */
export function renderPlanPage(
  c: Context<AppEnv>,
  result: Exclude<ViewPlanResult, { kind: "not_found" }>,
  form: { displayName: string; errorCode: string | undefined; nonce: string } = {
    displayName: "",
    errorCode: undefined,
    nonce: newNonce(),
  },
) {
  c.header("cache-control", "private, no-cache");
  const showForm = result.kind === "viewer" && result.responsesOpen;
  const { responsesOpen, ...audience } = result;
  return c.render(
    <PlanPage
      t={c.get("t")}
      language={c.get("language")}
      audience={audience}
      responsesOpen={responsesOpen}
      respondForm={showForm ? { ...form, csrfToken: c.get("csrfToken")() } : undefined}
    />,
    { title: result.view.title },
  );
}
