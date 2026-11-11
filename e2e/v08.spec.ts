// The 0.8 channels in a real browser against the built image (plan v1.0 step 6, decision D31):
// email notifications confirmed by their link and turned off from every email, and report alerts,
// against the fake mail server. Runs only in the "0.7 and 0.8 features" project (SMTP_*).
import { expect, test } from "@playwright/test";
import { adminLogIn, createPlan, newInvite, person, useInvite } from "./helpers.ts";

const RUN = Date.now().toString(36);
const MAIL = "http://localhost:8080/mail";

interface Mail {
  to: string[];
  text: string;
}

/** Waits for the job runner (every 10 seconds) to send the next email to this address. */
async function nextMail(to: string, after: number): Promise<Mail> {
  let mails: Mail[] = [];
  await expect
    .poll(
      async () => {
        mails = (await (await fetch(`${MAIL}?to=${encodeURIComponent(to)}`)).json()) as Mail[];
        return mails.length;
      },
      { timeout: 40_000, intervals: [1_000] },
    )
    .toBeGreaterThan(after);
  return mails[after] as Mail;
}

/** The email's link back to this instance. */
const linkIn = (mail: Mail) => /http:\/\/localhost:3103\/e\/[^\s"<>]+/.exec(mail.text)?.[0] ?? "";

test("Email: confirm by link, notifications, one-click off, report alerts", async ({
  browser,
  baseURL,
  request,
}) => {
  const problems: string[] = [];
  const base = baseURL ?? "";
  const ben = `ben-${RUN}@example.org`;
  const { page: admin } = await person(browser, base, problems);
  const { page: host } = await person(browser, base, problems);
  const { page: joiner } = await person(browser, base, problems);

  await adminLogIn(admin);
  await useInvite(host, await newInvite(admin));
  const planUrl = await createPlan(host, `Email run ${RUN}`);

  // Ben joins and asks for emails on his manage page.
  await joiner.goto(planUrl);
  await joiner.getByLabel("Your name").fill("Ben");
  await joiner.getByRole("button", { name: "I'm in" }).click();
  await joiner.goto(`${planUrl}/me`);
  await joiner.getByLabel("Email for news about this plan").fill(ben);
  await joiner.getByRole("button", { name: "Send confirmation link" }).click();
  await expect(joiner.getByText(`Open the link we sent to ${ben}`)).toBeVisible();

  // Only the confirmation link arrives; opening it in another browser changes nothing yet.
  const confirmation = await nextMail(ben, 0);
  const link = linkIn(confirmation);
  expect(link).not.toBe("");
  const { page: mailApp } = await person(browser, base, problems);
  await mailApp.goto(link);
  await expect(mailApp.getByRole("heading", { name: "Confirm your email address" })).toBeVisible();
  await mailApp.getByRole("button", { name: "Confirm address" }).click();
  await expect(mailApp.getByText("Address confirmed.")).toBeVisible();
  await joiner.reload();
  await expect(joiner.getByText(`Emails about this plan go to ${ben}.`)).toBeVisible();

  // The host cancels: Ben gets an email with the link to turn them off.
  await host.goto(`${planUrl}/host`);
  await host.getByText("Cancel plan…").click();
  await host.getByRole("button", { name: "Cancel this plan" }).click();
  const cancelled = await nextMail(ben, 1);
  expect(cancelled.text).toContain("The plan was cancelled.");
  expect(cancelled.text).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  expect(linkIn(cancelled)).toBe(link);

  // One click in the mail app turns them off, without cookies; the link then no longer works.
  const off = await request.post(link, {
    form: { "List-Unsubscribe": "One-Click" },
  });
  expect(off.status()).toBe(200);
  await joiner.reload();
  await expect(joiner.getByLabel("Email for news about this plan")).toBeVisible();
  expect((await request.get(link)).status()).toBe(404);

  // A report alerts the contact address, without the report's content.
  const alerts = (await (await fetch(`${MAIL}?to=e2e@example.org`)).json()) as Mail[];
  const { page: visitor } = await person(browser, base, problems);
  await visitor.goto(planUrl);
  await visitor.getByRole("link", { name: "Report this plan" }).click();
  await visitor.getByLabel("Spam or advertising").check();
  await visitor.getByLabel("Details").fill(`SENTINEL-${RUN}`);
  await visitor.getByRole("button", { name: "Send report" }).click();
  const alert = await nextMail("e2e@example.org", alerts.length);
  expect(alert.text).toContain("http://localhost:3103/admin/");
  expect(alert.text).not.toContain("SENTINEL");

  // Chrome logs the deliberate 404 of the used link as an error; nothing else may appear.
  expect(problems.filter((problem) => !problem.includes("status of 404"))).toEqual([]);
});
