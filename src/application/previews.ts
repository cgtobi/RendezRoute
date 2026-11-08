// Link preview images (spec 3.3): rendered from the public preview only, cached per plan version
// and deleted with the plan (spec 3.10).
import { previewOf } from "./plan-views.ts";
import type { PlanRepository, PreviewRenderer } from "./ports.ts";

export async function previewImage(
  deps: { plans: PlanRepository; renderer: PreviewRenderer },
  request: {
    planId: string;
    /** Asked only when the image must be rendered; false answers "limited" (rate limits). */
    mayRender?: () => boolean;
  },
): Promise<
  | { kind: "found"; image: Uint8Array }
  | { kind: "not_found" }
  | { kind: "busy" }
  | { kind: "limited" }
> {
  const plan = await deps.plans.findById(request.planId);
  if (plan === undefined) return { kind: "not_found" };
  const preview = previewOf(plan);
  const cached = await deps.plans.findPreview(plan.id, preview.version);
  if (cached !== undefined) return { kind: "found", image: cached };
  if (request.mayRender !== undefined && !request.mayRender()) return { kind: "limited" };
  const rendered = await deps.renderer.render(preview);
  if (!rendered.ok) return { kind: "busy" };
  await deps.plans.savePreview(plan.id, preview.version, rendered.value);
  return { kind: "found", image: rendered.value };
}
