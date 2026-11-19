import type { PlanInput } from "../../src/domain/plan-input.ts";
import { sampleInput } from "../fixtures/plans.ts";
import { hiddenFields, type TestClient } from "./client.ts";

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

/**
 * Responds through the plan page form (a request may carry a note); returns the response page and
 * its manage link path.
 */
export async function respondViaUi(
  client: TestClient,
  planId: string,
  displayName: string,
  choice: "interested" | "joined" | "requested",
  requestNote = "",
) {
  const hidden = await client.hiddenFields(`/p/${planId}`);
  const response = await client.postForm(`/p/${planId}/respond`, {
    ...hidden,
    displayName,
    choice,
    requestNote,
  });
  const html = await response.text();
  const managePath = /https:\/\/runs\.example\.org(\/m\/[A-Za-z0-9_-]{43})/.exec(html)?.[1];
  return { response, html, managePath };
}

/** Creates a plan with a route upload through the form, like a browser would. */
export async function createPlanWithRouteViaUi(
  client: TestClient,
  overrides: Partial<PlanInput>,
  gpx: string,
) {
  const hidden = await client.hiddenFields("/new");
  const response = await client.postMultipart(
    "/new",
    { ...hidden, ...planForm(overrides) },
    { gpx: { name: "run.gpx", content: gpx } },
  );
  const html = await response.text();
  const planId = /https:\/\/runs\.example\.org\/p\/([A-Za-z0-9_-]{22})/.exec(html)?.[1];
  const hostPath = /https:\/\/runs\.example\.org(\/a\/[A-Za-z0-9_-]{43})/.exec(html)?.[1];
  if (response.status !== 200 || planId === undefined || hostPath === undefined) {
    throw new Error(`plan creation failed: ${response.status} ${html.slice(0, 500)}`);
  }
  return { planId, hostPath, html };
}

/** The status line on the person's manage page, e.g. "Request pending". */
export async function ownStatus(client: TestClient, planId: string): Promise<string> {
  const html = await (await client.get(`/p/${planId}/me`)).text();
  const status =
    /<div class="status-text">(?:<h2>[^<]*<\/h2>)?<p>([^<]*)<\/p>/.exec(html)?.[1] ?? "";
  return status.replaceAll("&#39;", "'");
}

/** Presses the host page's button (accept, reject, remove, restore) in this person's row. */
export async function hostActsOn(
  host: TestClient,
  planId: string,
  action: "accept" | "reject" | "remove" | "restore",
  name: string,
): Promise<Response> {
  const page = await (await host.get(`/p/${planId}/host`)).text();
  // A row starts with the person's name, after their initial (decision D27).
  const row =
    page
      .split("<li>")
      .find(
        (item) =>
          item.startsWith('<span class="person-name">') && item.includes(`</span>${name}</span>`),
      ) ?? "";
  const form = new RegExp(`<form[^>]*action="([^"]+/${action})"[^]*?</form>`).exec(row);
  if (form?.[1] === undefined) throw new Error(`no ${action} button for ${name}`);
  return host.postForm(form[1], hiddenFields(form[0]));
}

/** All form fields of the host page's edit form (hidden and visible inputs, selects, textareas). */
export async function editForm(
  client: TestClient,
  planId: string,
): Promise<Record<string, string>> {
  const html = await (await client.get(`/p/${planId}/host`)).text();
  const form = /<form[^>]*action="\/p\/[^"]+\/host"[^>]*>([\s\S]*?)<\/form>/.exec(html)?.[1] ?? "";
  const fields: Record<string, string> = {};
  for (const input of form.matchAll(/<input[^>]*>/g)) {
    const name = /name="([^"]+)"/.exec(input[0])?.[1];
    const value = /value="([^"]*)"/.exec(input[0])?.[1] ?? "";
    const type = /type="([^"]+)"/.exec(input[0])?.[1];
    // As a browser sends it: no disabled field, no unchecked choice.
    if (
      name === undefined ||
      /\sdisabled/.test(input[0]) ||
      ((type === "radio" || type === "checkbox") && !/checked/.test(input[0]))
    )
      continue;
    fields[name] = value
      .replaceAll("&amp;", "&")
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">");
  }
  for (const select of form.matchAll(/<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    fields[select[1] ?? ""] =
      /<option value="([^"]*)" selected=""/.exec(select[2] ?? "")?.[1] ?? "";
  }
  for (const area of form.matchAll(/<textarea[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)) {
    fields[area[1] ?? ""] = (area[2] ?? "")
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">");
  }
  return fields;
}

/**
 * Saves the host page's edit form with a route file, as a browser sends it (decision D10). An
 * override of `undefined` leaves that field out.
 */
export async function uploadViaEdit(
  client: TestClient,
  planId: string,
  gpx: string | Uint8Array,
  overrides: Record<string, string | undefined> = {},
): Promise<Response> {
  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries({
    ...(await editForm(client, planId)),
    ...overrides,
  })) {
    if (value !== undefined && name !== "gpx") fields[name] = value;
  }
  return client.postMultipart(`/p/${planId}/host`, fields, {
    gpx: { name: "route.gpx", content: gpx },
  });
}
