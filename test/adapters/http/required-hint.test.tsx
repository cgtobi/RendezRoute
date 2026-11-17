// The "Required" hint and aria-required on every required control outside the plan form
// (decision D73, plan I90): the respond and manage forms, the admin login and plan search, the
// fediverse server, the email address, the host page's route upload and the template repeat form.
// The plan form's own fields are in plan-form.test.tsx.
import { describe, expect, it } from "vite-plus/test";
import { translator } from "../../../src/adapters/i18n/i18n.ts";
import { en as messages } from "../../../src/adapters/i18n/messages/en.ts";
import { EmailSwitch } from "../../../src/adapters/in/http/views/email-switch.tsx";
import { RespondForm } from "../../../src/adapters/in/http/views/respond-form.tsx";
import { createTestApp } from "../../support/app.ts";
import { hiddenFields, TestClient } from "../../support/client.ts";
import { createPlanViaUi, respondViaUi } from "../../support/plans.ts";

const t = translator("en");
const TOKEN = "admin-token-for-tests-0123456789abcdef";
const HINT = messages["field.requiredHint"];

/** The opening tag of the control with this id. */
function tagOf(html: string, id: string): string {
  const tag = new RegExp(`<(?:input|select|textarea)\\b[^>]*\\bid="${id}"[^>]*>`).exec(html)?.[0];
  if (tag === undefined) throw new Error(`no control #${id}`);
  return tag;
}

const attribute = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** No aria-describedby names a "-required" id, and every id it names exists in the page. */
function expectDescribedByResolves(html: string) {
  const present = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const named = [...html.matchAll(/\saria-describedby="([^"]*)"/g)].flatMap((m) =>
    (m[1] ?? "").split(" "),
  );
  expect(named.filter((name) => name.endsWith("-required"))).toEqual([]);
  expect(named.filter((name) => !present.has(name))).toEqual([]);
}

/**
 * A required control: aria-required, the aria-hidden visual hint with its id right after the
 * control (none on date and time), never named in aria-describedby, and a placeholder CSS can
 * test on text fields.
 */
function expectRequired(
  html: string,
  id: string,
  options: { textLike: boolean; placeholder?: string; noHint?: boolean },
) {
  const tag = tagOf(html, id);
  expect(tag).toMatch(/\srequired(?:=""|\s|\/|>)/);
  expect(attribute(tag, "aria-required")).toBe("true");
  expect(attribute(tag, "aria-describedby") ?? "").not.toContain("-required");
  expectDescribedByResolves(html);
  const hint = `<p class="required-hint" id="${id}-required" aria-hidden="true">${HINT}</p>`;
  const shown = options.noHint !== true;
  expect(html.includes(`id="${id}-required"`)).toBe(shown);
  const after = html.slice(html.indexOf(tag) + tag.length);
  // Right after the control: nothing in between, no pencil or wrapper.
  expect(after.startsWith(hint)).toBe(shown);
  expect(html.includes(hint)).toBe(shown);
  // Text-like fields: a blank placeholder, or a real example where the field has one (decision
  // D74). Other controls: no placeholder at all.
  expect(attribute(tag, "placeholder")).toBe(
    options.textLike ? (options.placeholder ?? " ") : undefined,
  );
}

/** The error replaces the hint: aria-invalid, described by the error only, no hint element. */
function expectErrorInstead(html: string, id: string, errorId: string) {
  const tag = tagOf(html, id);
  expect(attribute(tag, "aria-invalid")).toBe("true");
  expect(attribute(tag, "aria-describedby")?.split(" ")).toContain(errorId);
  expect(attribute(tag, "aria-describedby")).not.toContain(`${id}-required`);
  expectDescribedByResolves(html);
  expect(html).not.toContain(`id="${id}-required"`);
  expect(html).toContain(`id="${errorId}"`);
  expect(attribute(tag, "aria-required")).toBe("true");
}

/** Hono JSX elements stringify to their HTML; the type does not say so. */
// oxlint-disable-next-line typescript/no-base-to-string
const toHtml = (element: unknown): string => String(element);

describe("respond form", () => {
  const render = (errorCode?: "required") =>
    toHtml(
      <RespondForm
        t={t}
        planId="AAAAAAAAAAAAAAAAAAAAAA"
        joinMode="open"
        state={{
          csrfToken: "c",
          nonce: "n",
          displayName: "",
          requestNote: "",
          errorCode,
          noteErrorCode: undefined,
        }}
      />,
    );

  it("marks the name required with a hint, and names the instruction hint", () => {
    const html = render();
    expectRequired(html, "field-displayName", { textLike: true });
    expect(attribute(tagOf(html, "field-displayName"), "aria-describedby")).toBe(
      "field-displayName-hint",
    );
    expect(html).toContain('id="field-displayName-hint"');
  });

  it("shows the error instead of the hint", () => {
    expectErrorInstead(render("required"), "field-displayName", "field-displayName-error");
  });
});

describe("email address", () => {
  const render = (form?: { value: string; error: string }) =>
    toHtml(
      <EmailSwitch
        t={t}
        csrfToken="c"
        setting={{ kind: "setting", state: "off", accountAddress: undefined }}
        base="/p/x/me"
        form={form}
      />,
    );

  it("marks the address required, naming only its own hint in aria-describedby", () => {
    const html = render();
    expectRequired(html, "field-email", { textLike: true });
    expect(attribute(tagOf(html, "field-email"), "aria-describedby")).toBe("field-email-hint");
  });

  it("shows the error instead of the hint", () => {
    expectErrorInstead(
      render({ value: "x", error: "invalid" }),
      "field-email",
      "field-email-error",
    );
  });
});

describe("pages", () => {
  it("marks the name on the plan page and the manage page", async () => {
    const { app } = await createTestApp();
    const host = new TestClient(app);
    const { planId } = await createPlanViaUi(host);
    const visitor = new TestClient(app);
    expectRequired(await (await visitor.get(`/p/${planId}`)).text(), "field-displayName", {
      textLike: true,
    });
    await respondViaUi(visitor, planId, "Ben", "joined");
    const manage = await (await visitor.get(`/p/${planId}/me`)).text();
    expectRequired(manage, "field-displayName", { textLike: true });
    const fields = hiddenFields(manage);
    const refused = await visitor.postForm(`/p/${planId}/me`, {
      ...fields,
      displayName: "",
      choice: "joined",
    });
    const refusedHtml = await refused.text();
    expectErrorInstead(refusedHtml, "field-displayName", "field-displayName-error");
    // The manage page has no instruction hint under the name: the error alone.
    expect(attribute(tagOf(refusedHtml, "field-displayName"), "aria-describedby")).toBe(
      "field-displayName-error",
    );
    expect(attribute(tagOf(manage, "field-displayName"), "aria-describedby")).toBeUndefined();
  });

  it("marks the route file on the host page", async () => {
    const { app } = await createTestApp();
    const host = new TestClient(app);
    const { planId } = await createPlanViaUi(host);
    const html = await (await host.get(`/p/${planId}/host`)).text();
    expectRequired(html, "field-route", { textLike: false });
    expect(attribute(tagOf(html, "field-route"), "aria-describedby")).toBe("field-route-hint");
    const refused = await host.postMultipart(
      `/p/${planId}/host/route`,
      { _csrf: hiddenFields(html)._csrf ?? "" },
      { gpx: { name: "bad.gpx", content: "not a route" } },
    );
    expect(refused.status).toBe(422);
    expectErrorInstead(await refused.text(), "field-route", "field-route-error");
  });

  it("marks the admin token and the plan search", async () => {
    const { app } = await createTestApp({ env: { ADMIN_TOKEN: TOKEN } });
    const admin = new TestClient(app);
    const login = await (await admin.get("/admin/login")).text();
    expectRequired(login, "field-token", { textLike: true });
    expect(attribute(tagOf(login, "field-token"), "aria-describedby")).toBe("field-token-hint");
    await admin.postForm("/admin/login", { ...hiddenFields(login), token: TOKEN });
    const home = await (await admin.get("/admin/")).text();
    expectRequired(home, "field-plan", {
      textLike: true,
      placeholder: messages["placeholder.findPlan"],
    });
    const missing = await admin.postForm("/admin/plans", {
      ...hiddenFields(home),
      plan: "no plan here",
    });
    const missingHtml = await missing.text();
    expectErrorInstead(missingHtml, "field-plan", "field-plan-error");
    expect(attribute(tagOf(home, "field-plan"), "aria-describedby")).toBe("field-plan-hint");
    expect(attribute(tagOf(missingHtml, "field-plan"), "aria-describedby")).toBe(
      "field-plan-hint field-plan-error",
    );
  });

  it("marks the fediverse server on the account page", async () => {
    const { app } = await createTestApp({ env: { FEDIVERSE_LOGIN: "true" } });
    const client = new TestClient(app);
    const html = await (await client.get("/account")).text();
    expectRequired(html, "field-server", { textLike: true });
    expect(attribute(tagOf(html, "field-server"), "aria-describedby")).toBe("field-server-hint");
    const refused = await client.postForm("/login/fediverse", {
      ...hiddenFields(html.slice(html.indexOf('action="/login/fediverse"'))),
      server: "not a server",
    });
    expectErrorInstead(await refused.text(), "field-server", "field-server-error");
  });

  it("marks the date and time on the template page's repeat form", async () => {
    const { app } = await createTestApp();
    const host = new TestClient(app);
    const { planId } = await createPlanViaUi(host, { keepAsTemplate: "1" });
    const confirm = await (await host.get(`/p/${planId}/host/delete`)).text();
    await host.postForm(`/p/${planId}/host/delete`, hiddenFields(confirm));
    const templateId = /href="\/templates\/([\w-]+)"/.exec(await (await host.get("/")).text())?.[1];
    const page = await (await host.get(`/templates/${templateId}`)).text();
    expectRequired(page, "field-date", { textLike: false, noHint: true });
    expectRequired(page, "field-time", { textLike: false, noHint: true });
    const past = await host.postForm(`/templates/${templateId}/repeat`, {
      ...hiddenFields(page),
      date: "2001-01-01",
      time: "08:00",
    });
    expect(past.status).toBe(422);
    const html = await past.text();
    expectErrorInstead(html, "field-date", "field-date-error");
    // The time had no error: it still has aria-required and, as always, no visual hint.
    expectRequired(html, "field-time", { textLike: false, noHint: true });
  });
});
