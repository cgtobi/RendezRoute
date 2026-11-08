import type { PreviewRenderer } from "../../src/application/ports.ts";
import type { PlanPreview } from "../../src/application/plan-views.ts";

/** Records every preview it renders; answers "busy" while `busy` is set. */
export class FakePreviewRenderer implements PreviewRenderer {
  readonly rendered: PlanPreview[] = [];
  busy = false;

  render(preview: PlanPreview) {
    if (this.busy) return Promise.resolve({ ok: false as const, error: "busy" as const });
    this.rendered.push(preview);
    return Promise.resolve({
      ok: true as const,
      value: new TextEncoder().encode(`PNG:${preview.title}:${preview.version}`),
    });
  }
}
