// The admin listener behind a fake Home Assistant Ingress in a real browser against the built
// image (plan 0.10 step 10b, decision D56). The fakes container is the Supervisor: it answers the
// app's version check and proxies http://fakes:8080/ingress/e2e/ (and localhost:8080) to the admin listener with the
// identity headers; the app trusts only its address. Runs only in the "0.10 admin behind Ingress"
// project, against the fifth container (public port 3106, admin listener published on 3107 only to
// show that it refuses direct requests).
import { expect, test } from "@playwright/test";
import { createPlan, person, useInvite } from "./helpers.ts";

/**
 * The admin pages as the Home Assistant frontend's iframe loads them: under a path prefix. The
 * main flow runs on "fakes", plain http to another host, like Home Assistant on a LAN address:
 * there browsers send no Sec-Fetch-* and form posts carry `Origin: null` (decision I74), so only
 * the token vouches. localhost, where browsers do send fetch metadata, is checked as well.
 */
const INGRESS = "http://fakes:8080/ingress/e2e/";
const LOCAL_INGRESS = "http://localhost:8080/ingress/e2e/";
const NOT_ADMIN = "http://fakes:8080/ingress/e2e-user/";
const DIRECT = "http://localhost:3107";
const RUN = Date.now().toString(36);

test("the admin pages work through the fake Ingress, with no cookie and no login", async ({
  browser,
  baseURL,
}) => {
  const problems: string[] = [];
  const base = baseURL ?? "";

  // Reached directly, not through the Supervisor: the peer is the host's gateway, not the trusted
  // address, so even well-formed identity headers get a plain 403 that says nothing more.
  const direct = await fetch(`${DIRECT}/admin/`, {
    headers: {
      "x-remote-user-groups": "system-users,system-admin",
      "sec-fetch-site": "same-origin",
    },
  });
  expect(direct.status).toBe(403);
  expect(await direct.text()).not.toContain("administrator account");
  expect((await fetch(`${DIRECT}/healthz`)).status).toBe(403);

  // Through the Supervisor, as a user who is no administrator: told what is needed.
  const { page: user } = await person(browser, NOT_ADMIN, problems);
  const refused = await user.goto("admin/");
  expect(refused?.status()).toBe(403);
  await expect(
    user.getByText("Needs Home Assistant 2026.10.4 or newer and an administrator account."),
  ).toBeVisible();

  // As an administrator. The response headers of every request are collected on the way.
  const { context, page: admin } = await person(browser, INGRESS, problems);
  const responses: { url: string; setCookie: boolean; frame: string | undefined }[] = [];
  const posts: { url: string; site: string | undefined; origin: string | undefined }[] = [];
  context.on("request", async (request) => {
    if (request.method() !== "POST") return;
    const headers = await request.allHeaders();
    posts.push({ url: request.url(), site: headers["sec-fetch-site"], origin: headers["origin"] });
  });
  context.on("response", async (response) => {
    const headers = await response.allHeaders();
    responses.push({
      url: response.url(),
      setCookie: headers["set-cookie"] !== undefined,
      frame: /frame-ancestors ([^;]+)/.exec(headers["content-security-policy"] ?? "")?.[1],
    });
  });

  // The listener's root and the login page lead to the home, by relative redirects.
  await admin.goto("");
  await expect(admin).toHaveURL(`${INGRESS}admin/`);
  await expect(admin.getByRole("heading", { name: "Instance admin" })).toBeVisible();
  await admin.goto("admin/login");
  await expect(admin).toHaveURL(`${INGRESS}admin/`);
  await expect(admin.getByRole("button", { name: "Log out" })).toHaveCount(0);

  // Every link, asset and form address of the page is relative and works under the prefix.
  const html = await admin.content();
  const addresses = [
    ...html.matchAll(/<(?:a|link|form|script)\b[^>]*?\s(?:href|src|action)="([^"]*)"/g),
  ].map((match) => match[1] ?? "");
  expect(addresses.length).toBeGreaterThan(4);
  for (const address of addresses) expect(address).not.toMatch(/^(\/|[a-z][a-z0-9+.-]*:)/i);
  // Links and assets load; the forms' addresses are for posting, which the rest of the test does.
  const loadable = [...html.matchAll(/<(?:a|link|script)\b[^>]*?\s(?:href|src)="([^"]*)"/g)].map(
    (match) => match[1] ?? "",
  );
  for (const address of loadable.filter((entry) => !entry.startsWith("#"))) {
    const target = new URL(address, `${INGRESS}admin/`);
    if (target.pathname.endsWith("/logout")) continue;
    // From the page, so that the browser resolves "fakes" (the test process cannot).
    const status = await admin.evaluate(async (href) => (await fetch(href)).status, target.href);
    expect([address, status]).toEqual([address, 200]);
  }

  // An invite: the form post goes through the proxy; over plain http to "fakes" it carries the
  // token and Origin null and no Sec-Fetch-Site.
  await admin.getByRole("button", { name: "Create invite link" }).click();
  const invite = (await admin.locator(".link-box code").textContent()) ?? "";
  expect(invite).toMatch(/^http:\/\/localhost:3106\/i\/[A-Za-z0-9_-]{43}$/);
  const { page: host } = await person(browser, base, problems);
  await useInvite(host, invite);
  const title = `Ingress run ${RUN}`;
  const planUrl = await createPlan(host, title);

  // A report from the public port shows in the admin pages and can be resolved there.
  const { page: visitor } = await person(browser, base, problems);
  await visitor.goto(planUrl);
  await visitor.getByRole("link", { name: "Report this plan" }).click();
  await visitor.getByLabel("Spam or advertising").check();
  await visitor.getByRole("button", { name: "Send report" }).click();
  await expect(visitor.getByText("Thank you. Your report was sent to the admin.")).toBeVisible();
  await admin.goto("admin/");
  await admin.getByRole("link", { name: title }).click();
  await expect(admin.getByText("Spam or advertising")).toBeVisible();
  await admin.getByRole("button", { name: "Mark as resolved" }).click();
  await expect(admin.getByText("1 resolved report")).toBeVisible();

  // Finding a plan by its link, then deleting it.
  await admin.goto("admin/");
  await admin.getByLabel("Find a plan").fill(planUrl);
  await admin.getByRole("button", { name: "Find plan" }).click();
  await expect(admin.getByRole("heading", { name: `Plan: ${title}` })).toBeVisible();

  // Revoking an invite ends it on the public port.
  await admin.goto("admin/");
  await admin.getByRole("button", { name: "Create invite link" }).click();
  const second = (await admin.locator(".link-box code").textContent()) ?? "";
  await admin.goto("admin/");
  await admin.getByRole("button", { name: "Revoke" }).first().click();
  const { page: late } = await person(browser, base, problems);
  await late.goto(second);
  await expect(late.getByText("This invite link is not valid.")).toBeVisible();

  // Every form post of this flow, on a non-localhost http origin: no fetch metadata, Origin null,
  // and all of them succeeded (the steps above depend on it).
  expect(posts.length).toBeGreaterThanOrEqual(5);
  for (const post of posts) {
    expect(post.url.startsWith(INGRESS)).toBe(true);
    expect([post.url, post.site, post.origin]).toEqual([post.url, undefined, "null"]);
  }

  // On localhost the browser does send Sec-Fetch-Site (same-origin) and the same token works.
  const { page: local } = await person(browser, LOCAL_INGRESS, problems);
  let localSite: string | undefined;
  local.on("request", async (request) => {
    if (request.method() === "POST") localSite = (await request.allHeaders())["sec-fetch-site"];
  });
  await local.goto("admin/");
  await local.getByLabel("Find a plan").fill(planUrl);
  await local.getByRole("button", { name: "Find plan" }).click();
  await expect(local.getByRole("heading", { name: `Plan: ${title}` })).toBeVisible();
  expect(localSite).toBe("same-origin");

  // No cookie anywhere: none stored for the admin's origin, none ever set, and every response
  // allows the Home Assistant frontend to frame it.
  expect(await context.cookies()).toEqual([]);
  expect(responses.length).toBeGreaterThan(10);
  expect(responses.filter((entry) => entry.setCookie)).toEqual([]);
  expect(
    responses.filter((entry) => entry.frame !== "'self'" && !entry.url.includes("/static/")),
  ).toEqual([]);

  // The only console errors are the two pages this test asked for: the refusal of the user who is
  // no administrator and the revoked invite's 404 page on the public port.
  expect(problems).toEqual([
    expect.stringMatching(/status of 403.* @ http:\/\/fakes:8080\/ingress\/e2e-user\/admin\/$/),
    expect.stringMatching(/status of 404.* @ http:\/\/localhost:3106\/i\//),
  ]);
});
