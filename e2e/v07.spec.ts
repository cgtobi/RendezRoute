// The 0.7 features in a real browser against the built image (plan v1.0 0.7 wrap-up, spec 2b):
// the instance admin, invite links, reporting, and accounts with OIDC and fediverse login, against
// fake providers. Runs only in the "0.7 and 0.8 features" project (ADMIN_TOKEN, POSTING_MODE=invite).
import { expect, test } from "@playwright/test";
import { adminLogIn, createPlan, newInvite, oidcLogIn, person, useInvite } from "./helpers.ts";

/** Plan titles of this run, so a kept volume (E2E_KEEP=true) cannot mix runs up. */
const RUN = Date.now().toString(36);

test("Invite links, reporting and the instance admin", async ({ browser, baseURL }) => {
  const problems: string[] = [];
  const base = baseURL ?? "";
  const { page: admin } = await person(browser, base, problems);
  const { page: host } = await person(browser, base, problems);
  const { page: visitor } = await person(browser, base, problems);

  // Posting needs an invite: the create form says how to get one.
  await host.goto("/new");
  await expect(host.getByText("only people with an invite link can create plans")).toBeVisible();

  await adminLogIn(admin);
  await useInvite(host, await newInvite(admin));
  const title = `Invited run ${RUN}`;
  const planUrl = await createPlan(host, title);

  // The host link works on a second device after confirming it (decision D1; its page is sent
  // with Referrer-Policy: no-referrer, so the form arrives with Origin: null).
  const hostLink = (await host.locator(".links .link-box code").textContent()) ?? "";
  const { page: cohost } = await person(browser, base, problems);
  await cohost.goto(hostLink);
  await cohost.getByRole("button", { name: "Use on this device" }).click();
  await expect(cohost).toHaveURL(planUrl);
  await expect(cohost.getByText("You are the host of this plan.")).toBeVisible();

  // Anyone who can open the plan can report it, without an account.
  await visitor.goto(planUrl);
  await visitor.getByRole("link", { name: "Report this plan" }).click();
  await visitor.getByLabel("Spam or advertising").check();
  await visitor.getByRole("button", { name: "Send report" }).click();
  await expect(visitor.getByText("Thank you. Your report was sent to the admin.")).toBeVisible();

  // The admin finds it among the open reports and resolves it.
  await admin.goto("/admin/");
  await admin.getByRole("link", { name: title }).click();
  await expect(admin.getByText("Spam or advertising")).toBeVisible();
  await admin.getByRole("button", { name: "Mark as resolved" }).click();
  await expect(admin.getByText("1 resolved report")).toBeVisible();

  expect(problems).toEqual([]);
});

test("Accounts: OIDC login, claiming and account deletion", async ({ browser, baseURL }) => {
  const problems: string[] = [];
  const base = baseURL ?? "";
  const { page: admin } = await person(browser, base, problems);
  const { page: phone } = await person(browser, base, problems);
  const { page: laptop } = await person(browser, base, problems);

  // A browser with an invite creates a plan, then logs in and moves it into the account.
  await adminLogIn(admin);
  await useInvite(phone, await newInvite(admin));
  const title = `Claimed run ${RUN}`;
  const planUrl = await createPlan(phone, title);
  await oidcLogIn(phone);
  await expect(phone.getByText("1 plan you host")).toBeVisible();
  await phone.getByRole("link", { name: "Review and move into my account" }).click();
  await expect(phone.getByText(title)).toBeVisible();
  await phone.getByRole("button", { name: "Move 1 plan into my account" }).click();
  await expect(phone.getByText("Moved into your account.")).toBeVisible();

  // Another browser logged in to the same account manages the plan.
  await oidcLogIn(laptop);
  await expect(laptop.locator("#field-displayName")).toHaveValue("Erika E2E");
  await laptop.goto(`${planUrl}/host`);
  await expect(laptop.getByRole("heading", { name: "Manage your plan" })).toBeVisible();

  // Deleting the account deletes the plan for everyone and logs the browsers out.
  await laptop.goto("/account");
  await laptop.getByRole("link", { name: "Delete account" }).click();
  await expect(laptop.getByText(title)).toBeVisible();
  await laptop.getByRole("button", { name: "Delete account for good" }).click();
  await expect(laptop.getByText("Your account was deleted.")).toBeVisible();
  const gone = await phone.goto(planUrl);
  expect(gone?.status()).toBe(404);

  // Chrome logs the deliberate 404 of the deleted plan page as an error; nothing else may appear.
  const expected404 = `console: Failed to load resource: the server responded with a status of 404 (Not Found) @ ${planUrl}`;
  expect(problems.filter((problem) => problem !== expected404)).toEqual([]);
});

test("Fediverse login through a Mastodon-API server", async ({ browser, baseURL }) => {
  const problems: string[] = [];
  const { page } = await person(browser, baseURL ?? "", problems);
  await page.goto("/account");
  await page.getByLabel("Your server").fill("http://fakes:8080");
  await page.getByRole("button", { name: "Continue" }).click();
  // The server is shown before the browser goes there.
  await page.getByRole("link", { name: "Continue to fakes:8080" }).click();
  await expect(page.getByText("You are logged in.")).toBeVisible();
  await expect(page.locator("#field-displayName")).toHaveValue("Erika (fediverse)");
  expect(problems).toEqual([]);
});
