// The admin pages on their own listener in a real browser against the built image (plan 0.10 step
// 10a, decision D55): `/admin` is a plain 404 on the public port, and the admin pages work on the
// second port with their own cookies. Runs only in the "0.10 admin listener" project, against the
// fourth container (public port 3104, admin port 3105, ADMIN_URL set, invite-only posting).
import { expect, test } from "@playwright/test";
import { adminLogIn, createPlan, newInvite, person, useInvite } from "./helpers.ts";

const ADMIN = "http://localhost:3105";
const RUN = Date.now().toString(36);

test("`/admin` is 404 on the public port, and the admin pages work on the admin port", async ({
  browser,
  baseURL,
}) => {
  const problems: string[] = [];
  const base = baseURL ?? "";

  // The public port knows nothing of /admin, for GET and for a post.
  for (const path of ["/admin", "/admin/", "/admin/login", "/admin/reports"]) {
    const status = (await fetch(`${base}${path}`, { redirect: "manual" })).status;
    expect([path, status]).toEqual([path, 404]);
  }
  // With a valid CSRF token and cookie from a public page, so the 404 is the route's.
  const form = await fetch(`${base}/privacy`);
  const token = /name="_csrf" value="([^"]+)"/.exec(await form.text())?.[1] ?? "";
  const cookie = (form.headers.getSetCookie()[0] ?? "").split(";")[0] ?? "";
  expect(token).not.toBe("");
  expect(
    (
      await fetch(`${base}/admin/login`, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie, origin: base },
        body: new URLSearchParams({ _csrf: token }).toString(),
      })
    ).status,
  ).toBe(404);
  // The admin port's root leads to the admin home; it knows nothing of the public pages.
  const root = await fetch(`${ADMIN}/`, { redirect: "manual" });
  expect([root.status, root.headers.get("location")]).toEqual([303, "admin/"]);
  expect((await fetch(`${ADMIN}/nearby`, { redirect: "manual" })).status).toBe(404);
  expect((await fetch(`${ADMIN}/healthz`)).status).toBe(200);

  // Logging in on the admin port: its own cookies, HttpOnly and SameSite=Strict.
  const { context, page: admin } = await person(browser, ADMIN, problems);
  await adminLogIn(admin);
  const cookies = await context.cookies(ADMIN);
  const session = cookies.find((cookie) => cookie.name === "rr-admin-split");
  expect(session).toMatchObject({ httpOnly: true, sameSite: "Strict", secure: false, path: "/" });
  const csrf = cookies.find((cookie) => cookie.name === "rr-admin-csrf");
  expect(csrf).toMatchObject({ httpOnly: true, sameSite: "Strict", secure: false, path: "/" });
  expect(cookies.map((cookie) => cookie.name).sort()).toEqual(["rr-admin-csrf", "rr-admin-split"]);

  // An invite from the admin page works on the public port; its link names the public address.
  const invite = await newInvite(admin);
  expect(invite).toMatch(/^http:\/\/localhost:3104\/i\//);
  const { page: host } = await person(browser, base, problems);
  await useInvite(host, invite);
  const title = `Split run ${RUN}`;
  const planUrl = await createPlan(host, title);
  await host.goto("/");
  expect(await host.content()).not.toContain('href="/admin');
  expect(await host.content()).not.toContain("3105");

  // A report from the public port shows in the admin pages and can be resolved there.
  const { page: visitor } = await person(browser, base, problems);
  await visitor.goto(planUrl);
  await visitor.getByRole("link", { name: "Report this plan" }).click();
  await visitor.getByLabel("Spam or advertising").check();
  await visitor.getByRole("button", { name: "Send report" }).click();
  await expect(visitor.getByText("Thank you. Your report was sent to the admin.")).toBeVisible();
  await admin.goto("/admin/");
  await admin.getByRole("link", { name: title }).click();
  await expect(admin.getByText("Spam or advertising")).toBeVisible();
  await admin.getByRole("button", { name: "Mark as resolved" }).click();
  await expect(admin.getByText("1 resolved report")).toBeVisible();

  // Revoking an invite on the admin port ends it on the public port.
  const second = await newInvite(admin);
  const { page: late } = await person(browser, base, problems);
  await admin.goto("/admin/");
  await admin.getByRole("button", { name: "Revoke" }).first().click();
  await late.goto(second);
  await expect(late.getByText("This invite link is not valid.")).toBeVisible();

  // The admin session is not valid on the public port, nor does it log in anyone there.
  const { page: stray } = await person(browser, base, problems);
  await stray
    .context()
    .addCookies([{ name: "rr-admin-split", value: session?.value ?? "", url: base }]);
  expect((await stray.goto("/admin/"))?.status()).toBe(404);

  // The only console errors are the two 404 pages this test asked for: the revoked invite and
  // /admin on the public port.
  expect(problems).toEqual([
    expect.stringMatching(/status of 404.* @ http:\/\/localhost:3104\/i\//),
    expect.stringMatching(/status of 404.* @ http:\/\/localhost:3104\/admin\/$/),
  ]);
});
