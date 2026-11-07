import type { PlanInput } from "../../src/domain/plan-input.ts";
import { sampleInput } from "../fixtures/plans.ts";
import type { TestClient } from "./client.ts";

/** Form field names are the PlanInput keys. */
export function planForm(overrides: Partial<PlanInput> = {}): Record<string, string> {
  return { ...sampleInput, ...overrides };
}

/** Creates a plan through the UI and returns its ID, host link path and the links page. */
export async function createPlanViaUi(client: TestClient, overrides: Partial<PlanInput> = {}) {
  const hidden = await client.hiddenFields("/new");
  const response = await client.postForm("/new", { ...hidden, ...planForm(overrides) });
  const html = await response.text();
  const hostPath = /https:\/\/runs\.example\.org(\/a\/[A-Za-z0-9_-]{43})/.exec(html)?.[1];
  const planId = /https:\/\/runs\.example\.org\/p\/([A-Za-z0-9_-]{22})/.exec(html)?.[1];
  if (response.status !== 200 || hostPath === undefined || planId === undefined) {
    throw new Error(`plan creation failed: ${response.status} ${html.slice(0, 500)}`);
  }
  return { planId, hostPath, html, response, hidden };
}
