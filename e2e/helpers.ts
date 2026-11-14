// Shared by the end-to-end specs.
import {
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  expect,
  type Page,
  test,
} from "@playwright/test";

/** A date five days from now, as the date field expects it: within the weather horizon. */
export const inFiveDays = () =>
  new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const ALLOWED_HOSTS = new Set([
  "localhost:3101",
  "localhost:3102",
  "localhost:3103",
  "localhost:3104",
  "localhost:3105",
  "fakes:8080",
]);

/** Counts people in this worker, for their addresses. */
let people = 0;

/** A browser profile of its own (own cookies), failing the test on console errors or foreign requests. */
export async function person(
  browser: Browser,
  baseURL: string,
  problems: string[],
  options: { initScript?: () => void; context?: BrowserContextOptions } = {},
) {
  const context: BrowserContext = await browser.newContext({
    ...options.context,
    baseURL,
    // A network of their own (TRUST_PROXY for the accounts container in compose.yaml): the
    // per-client limits apply per person. Each worker has its own range, so none share one.
    extraHTTPHeaders: {
      ...options.context?.extraHTTPHeaders,
      "x-forwarded-for": `10.${test.info().parallelIndex}.${Math.floor(++people / 250)}.${(people % 250) + 1}`,
    },
  });
  if (options.initScript !== undefined) await context.addInitScript(options.initScript);
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") {
      problems.push(`console: ${message.text()} @ ${message.location().url}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol !== "data:" && !ALLOWED_HOSTS.has(url.host)) {
      problems.push(`request to ${url.host}`);
    }
  });
  return { context, page };
}

// The instance with admin, invites, logins and email (third container, decisions D21, D31).
const ADMIN_TOKEN = "e2e-admin-token-0123456789abcdefghij";

export async function adminLogIn(admin: Page) {
  await admin.goto("/admin/login");
  await admin.getByLabel("Admin token").fill(ADMIN_TOKEN);
  await admin.getByRole("button", { name: "Log in" }).click();
  await expect(admin.getByRole("heading", { name: "Instance admin" })).toBeVisible();
}

/** The admin creates an invite link; returns it. */
export async function newInvite(admin: Page): Promise<string> {
  await admin.goto("/admin/");
  await admin.getByRole("button", { name: "Create invite link" }).click();
  const link = (await admin.locator(".link-box code").textContent()) ?? "";
  expect(link).toMatch(/\/i\/[A-Za-z0-9_-]{43}$/);
  return link;
}

export async function useInvite(page: Page, link: string) {
  await page.goto(link);
  await expect(
    page.getByRole("heading", { name: "Use this invite on this device?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Use on this device" }).click();
  await expect(page).toHaveURL(/\/new$/);
}

/** Logs the page in through the fake OIDC provider, which approves at once. */
export async function oidcLogIn(page: Page) {
  await page.goto("/account");
  await page.getByRole("link", { name: "Log in with E2E login" }).click();
  await expect(page.getByText("You are logged in.")).toBeVisible();
}

/** Creates a plan from the create form the page is on; returns the plan's address. */
export async function createPlan(page: Page, title: string): Promise<string> {
  await page.getByLabel("Your name").fill("Anna");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Date").fill(inFiveDays());
  await page.getByLabel("Start time").fill("08:30");
  await page.locator("#field-areaLabel").fill("Flaucher");
  await page.getByRole("button", { name: "Create plan" }).click();
  await expect(page.getByRole("heading", { name: "Your plan is ready" })).toBeVisible();
  return (await page.locator(".links .link-box a").textContent()) ?? "";
}
