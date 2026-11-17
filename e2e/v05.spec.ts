// v0.5 flows in a real browser against the built image (spec 6 acceptance criteria, plan step 11):
// approval with a note, push permission denied, and a calendar feed following the plan.
import { expect, type Page, test } from "@playwright/test";
import { inFiveDays, openFold, person } from "./helpers.ts";

/** A plan without maps, so both projects fill the same fields. */
async function createPlan(host: Page, title: string, approval = false): Promise<string> {
  await host.goto("/new");
  await host.getByLabel("Your name").fill("Anna");
  await host.getByLabel("Title").fill(title);
  await host.getByLabel("Date").fill(inFiveDays());
  await host.getByLabel("Start time").fill("08:30");
  await host.locator("#field-areaLabel").fill("Flaucher, north end");
  await openFold(host, "Exact meeting point");
  await host.getByLabel("Description of the meeting point").fill("North gate, by the bike racks");
  if (approval) {
    await openFold(host, "Who can join and find it");
    await host.getByLabel("Only people I accept").check();
  }
  await host.getByRole("button", { name: "Create plan" }).click();
  await expect(host.getByRole("heading", { name: "Your plan is ready" })).toBeVisible();
  return (await host.locator(".links .link-box a").textContent()) ?? "";
}

/** Cancels the plan from its host page and waits until that is done. */
async function cancel(host: Page, planUrl: string) {
  await host.goto(`${planUrl}/host`);
  await host.getByText("Cancel plan…").click();
  await host.getByRole("button", { name: "Cancel this plan" }).click();
  await expect(
    host.getByText(/was cancelled\. You can still change when it is deleted/),
  ).toBeVisible();
}

test("Approval: a request with a note sees the exact start only once accepted", async ({
  browser,
  baseURL,
}) => {
  const problems: string[] = [];
  const { page: host } = await person(browser, baseURL ?? "", problems);
  const { page: ben } = await person(browser, baseURL ?? "", problems);
  const planUrl = await createPlan(host, "Hill repeats", true);

  await ben.goto(planUrl);
  await ben.getByLabel("Your name").fill("Ben");
  await ben.getByLabel("Note to the host (optional)").fill("I run 5:45 per km");
  await ben.getByRole("button", { name: "Request to join" }).click();
  await expect(ben.getByRole("heading", { name: "Response saved" })).toBeVisible();
  await ben.goto(planUrl);
  await expect(ben.getByText("Request pending")).toBeVisible();
  expect(await ben.content()).not.toContain("North gate");

  await host.goto(`${planUrl}/host`);
  await expect(host.getByText("I run 5:45 per km")).toBeVisible();
  await host.getByRole("button", { name: "Accept" }).click();
  await expect(host.getByRole("button", { name: "Accept" })).toHaveCount(0);

  await ben.reload();
  await expect(ben.getByText("North gate, by the bike racks")).toBeVisible();
  expect(problems).toEqual([]);
});

test("The app works fully if push permission is denied", async ({ browser, baseURL }) => {
  const problems: string[] = [];
  // Runs in the browser, where Notification exists; the specs are typed without the DOM.
  const denied = () => {
    const { Notification } = globalThis as unknown as {
      Notification: { requestPermission: () => Promise<string> };
    };
    Object.defineProperty(Notification, "permission", { get: () => "denied" });
    Notification.requestPermission = () => Promise.resolve("denied");
  };
  const { page: host } = await person(browser, baseURL ?? "", problems, { initScript: denied });
  const { page: ben } = await person(browser, baseURL ?? "", problems, { initScript: denied });
  const planUrl = await createPlan(host, "Denied push run");

  await host.goto(`${planUrl}/host`);
  await expect(
    host.getByText("Notifications are blocked in this browser’s settings."),
  ).toBeVisible();

  await ben.goto(planUrl);
  await ben.getByLabel("Your name").fill("Ben");
  await ben.getByRole("button", { name: "I'm in" }).click();
  await expect(ben.getByRole("heading", { name: "Response saved" })).toBeVisible();
  await ben.goto(`${planUrl}/me`);
  await expect(
    ben.getByText("Notifications are blocked in this browser’s settings."),
  ).toBeVisible();
  await expect(ben.locator(".manage .status-text p")).toHaveText("You're in");
  await ben.getByLabel("Interested").check();
  await ben.getByRole("button", { name: "Save changes" }).click();
  await expect(ben.locator(".manage .status-text p")).toHaveText("Interested");

  // Changes still reach everyone through the pages themselves.
  await cancel(host, planUrl);
  await ben.goto(planUrl);
  await expect(ben.getByText("This plan was cancelled.")).toBeVisible();
  expect(problems).toEqual([]);
});

test("Calendar feed reflects changes, cancellations and deletions on the next poll", async ({
  browser,
  baseURL,
  request,
}) => {
  const problems: string[] = [];
  const { page: host } = await person(browser, baseURL ?? "", problems);
  const { page: ben } = await person(browser, baseURL ?? "", problems);
  const planUrl = await createPlan(host, "Feed run");

  await ben.goto(planUrl);
  await ben.getByLabel("Your name").fill("Ben");
  await ben.getByRole("button", { name: "I'm in" }).click();
  await expect(ben.getByRole("heading", { name: "Response saved" })).toBeVisible();
  await ben.goto("/calendar");
  await ben.getByRole("button", { name: "Create calendar link" }).click();
  const feedUrl = (await ben.locator(".link-box code").textContent()) ?? "";
  expect(feedUrl).toMatch(/\/c\/[\w-]{43}$/);
  // Calendar servers fetch without the browser's cookies: the test's own request context has none.
  const poll = async () => {
    const response = await request.get(feedUrl);
    expect(response.status()).toBe(200);
    return (await response.text()).replaceAll("\r\n ", "");
  };
  expect(await poll()).toContain("SUMMARY:Feed run");

  await host.goto(`${planUrl}/host`);
  await host.getByLabel("Title").fill("Feed run, later");
  await host.getByRole("button", { name: "Save changes" }).click();
  await expect(host.getByText("Changes saved.")).toBeVisible();
  expect(await poll()).toContain("SUMMARY:Feed run\\, later");

  await cancel(host, planUrl);
  expect(await poll()).toContain("STATUS:CANCELLED");

  await host.goto(`${planUrl}/host`);
  await host.getByRole("link", { name: "Delete plan…" }).click();
  await host.getByRole("button", { name: "Delete for good" }).click();
  await expect(host.getByText("This plan no longer exists.")).toBeVisible();
  expect(await poll()).not.toContain("Feed run");
  // Chrome logs the deliberate 404 of the deleted plan page as an error; nothing else may appear.
  const expected404 = `console: Failed to load resource: the server responded with a status of 404 (Not Found) @ ${planUrl}`;
  expect(problems.filter((problem) => problem !== expected404)).toEqual([]);
});
