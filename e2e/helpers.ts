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
  "localhost:3106",
  "localhost:8080",
  "fakes:8080",
]);

/** A 1x1 transparent PNG, standing in for every map tile in WebKit. */
const TILE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * WebKit cannot resolve the test host `fakes` (Chromium gets a --host-resolver-rules launch flag
 * in playwright.config.ts), so its tile requests would fail with a console error. Fulfil them
 * with a transparent pixel. Does nothing in other browsers.
 */
export async function stubTileHost(context: BrowserContext): Promise<void> {
  if (context.browser()?.browserType().name() !== "webkit") return;
  await context.route("http://fakes:8080/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TILE_PNG }),
  );
}

/**
 * WebKit alone logs this for every native <select> (measured: a bare select with no author CSS
 * does it): its own control behaviour, not an inline style of our markup. The default Chromium
 * projects run the same specs with this message counted, so a real inline-style violation of ours
 * still fails there.
 */
const WEBKIT_SELECT_CSP =
  /Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive/;

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
  await stubTileHost(context);
  const webkit = browser.browserType().name() === "webkit";
  if (options.initScript !== undefined) await context.addInitScript(options.initScript);
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error" && !(webkit && WEBKIT_SELECT_CSP.test(message.text()))) {
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

/**
 * Opens a fold of the plan form ("Exact meeting point", "Route, pace and note", "Who can join and
 * find it", "Look and sharing", "After the run") unless it is open already.
 */
export async function openFold(page: Page, title: string) {
  const fold = page.locator("details.fold", {
    has: page.locator(".fold-title", { hasText: title }),
  });
  if ((await fold.getAttribute("open")) === null) await fold.locator("> summary").click();
  await expect(fold).toHaveAttribute("open", "");
}

/** Opens the muted time zone line, so the select inside it can be used. */
export async function openZoneLine(page: Page) {
  const line = page.locator("details.zone-line");
  if ((await line.getAttribute("open")) === null) await line.locator("> summary").click();
  await expect(line).toHaveAttribute("open", "");
}

/** Fills "Your name", opening the collapsed "Hosting as ..." line first when the name is prefilled. */
export async function fillHostName(page: Page, name: string) {
  const line = page.locator("details.host-name");
  if ((await line.count()) > 0 && (await line.getAttribute("open")) === null) {
    await line.locator("> summary").click();
  }
  await page.getByLabel("Your name").fill(name);
}

/**
 * Fills the start time with any minute. The field asks for 15-minute steps and Chromium refuses to
 * submit a time off that grid, so the step is removed from this one input first (written as a
 * string, as the e2e project has no DOM types, like the other in-page work here).
 */
export async function fillTimeOffGrid(page: Page, time: string): Promise<void> {
  // A plain expression: Playwright runs it, while a function written as a string is not called.
  await page.evaluate(`document.querySelector("#field-time").removeAttribute("step")`);
  await page.getByLabel("Start time").fill(time);
}

/** Creates a plan from the create form the page is on; returns the plan's address. */
export async function createPlan(page: Page, title: string): Promise<string> {
  await fillHostName(page, "Anna");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Date").fill(inFiveDays());
  await page.getByLabel("Start time").fill("08:30");
  await page.locator("#field-areaLabel").fill("Flaucher");
  await page.getByRole("button", { name: "Create plan" }).click();
  await expect(page.getByRole("heading", { name: "Your plan is ready" })).toBeVisible();
  return (await page.locator(".links .link-box a").textContent()) ?? "";
}
