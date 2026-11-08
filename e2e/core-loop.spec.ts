// The v0.1 core loop in a real browser against the built image (spec 5 acceptance criteria, 2b).
// Runs once per project: default settings (fake providers) and maps, geocoder and weather disabled.
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";

const ALLOWED_HOSTS = new Set(["localhost:3101", "localhost:3102", "fakes:8080"]);

/** A browser profile of its own (own cookies), failing the test on console errors or foreign requests. */
async function person(browser: Browser, baseURL: string, problems: string[]) {
  const context: BrowserContext = await browser.newContext({ baseURL });
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

/** A date a week from now, as the date field expects it. */
const nextWeek = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

async function createPlan(host: Page, withMaps: boolean): Promise<{ planUrl: string }> {
  await host.goto("/");
  await host.getByRole("link", { name: "Plan a run or ride" }).click();
  await host.getByLabel("Your name").fill("Anna");
  await host.getByLabel("Title").fill("Sunday long run");
  await host.getByLabel("Date").fill(nextWeek());
  await host.getByLabel("Start time").fill("08:30");

  if (withMaps) {
    // Place search sets the public area; tapping the map sets the exact start.
    await host.getByLabel("Find a place").fill("Flaucher");
    await host.getByRole("button", { name: "Search" }).click();
    await host.getByRole("button", { name: /Flaucher/ }).click();
    await expect(host.locator("#field-areaLabel")).toHaveValue(/Flaucher/);
    await host.locator(".map-picker .map").click();
  } else {
    await expect(host.locator("[data-map-picker]")).toHaveCount(0);
    await expect(host.locator("[data-place-search]")).toHaveCount(0);
    await host.locator("#field-areaLabel").fill("Flaucher, north end");
    await host.getByText("Coordinates (optional)").click();
    // The exact start's coordinates (the area has its own, optional pair).
    await host.locator("#field-exactLat").fill("48.11070");
    await host.locator("#field-exactLng").fill("11.55820");
  }
  await host.getByLabel("Where exactly?").fill("North gate, by the bike racks");
  await host.getByRole("button", { name: "Create plan" }).click();

  await expect(host.getByRole("heading", { name: "Your plan is ready" })).toBeVisible();
  const planUrl = (await host.locator(".links .link-box a").textContent()) ?? "";
  expect(planUrl).toMatch(/\/p\/[A-Za-z0-9_-]{22}$/);
  // Sharing: plain links to the public plan address, never the host link.
  const whatsApp = await host.getByRole("link", { name: "WhatsApp" }).getAttribute("href");
  expect(whatsApp).toContain(encodeURIComponent(planUrl));
  return { planUrl };
}

test("A plan can be created, shared, joined, cancelled and deleted without any account", async ({
  browser,
  baseURL,
}, testInfo) => {
  const withMaps = testInfo.project.name === "default settings";
  const problems: string[] = [];
  const base = baseURL ?? "";
  const { page: host } = await person(browser, base, problems);
  const { page: viewer } = await person(browser, base, problems);
  const { page: joiner } = await person(browser, base, problems);

  // Create and share.
  const { planUrl } = await createPlan(host, withMaps);

  // A viewer sees the public plan and its preview, never the exact start.
  await viewer.goto(planUrl);
  await expect(viewer.getByRole("heading", { name: "Sunday long run" })).toBeVisible();
  expect(await viewer.content()).not.toContain("North gate");
  const image = await viewer.locator('meta[property="og:image"]').getAttribute("content");
  const card = await viewer.request.get(image ?? "");
  expect(card.status()).toBe(200);
  expect(card.headers()["content-type"]).toBe("image/png");
  if (withMaps) await expect(viewer.locator("[data-plan-map] .leaflet-tile").first()).toBeVisible();
  else await expect(viewer.locator("[data-plan-map]")).toHaveCount(0);

  // Join: the joiner then sees the exact start.
  await joiner.goto(planUrl);
  await joiner.getByLabel("Your name").fill("Ben");
  await joiner.getByRole("button", { name: "I'm in" }).click();
  await expect(joiner.getByRole("heading", { name: "Response saved" })).toBeVisible();
  await joiner.getByRole("link", { name: "Back to the plan" }).click();
  await expect(joiner.getByText("North gate, by the bike racks")).toBeVisible();

  // Cancel: final, with a banner for everyone.
  await host.goto(`${planUrl}/host`);
  await host.getByText("Cancel plan…").click();
  await host.getByRole("button", { name: "Cancel this plan" }).click();
  // Back on the host page, only the deletion date can still be changed.
  await expect(
    host.getByText(/was cancelled\. You can still change when it is deleted/),
  ).toBeVisible();
  await host.goto(planUrl);
  await expect(host.getByText("This plan was cancelled.")).toBeVisible();
  await expect(host.getByRole("link", { name: "WhatsApp" })).toHaveCount(0);
  await joiner.reload();
  await expect(joiner.getByText("This plan was cancelled.")).toBeVisible();

  // Delete: gone for everyone, indistinguishable from a plan that never existed.
  await host.goto(`${planUrl}/host`);
  await host.getByRole("link", { name: "Delete plan…" }).click();
  await host.getByRole("button", { name: "Delete for good" }).click();
  await expect(host.getByText("This plan no longer exists.")).toBeVisible();
  const gone = await viewer.goto(planUrl);
  expect(gone?.status()).toBe(404);
  await expect(viewer.getByText("This plan no longer exists.")).toBeVisible();

  // Chrome logs the deliberate 404 of the deleted plan page as an error; nothing else may appear.
  const expected404 = `console: Failed to load resource: the server responded with a status of 404 (Not Found) @ ${planUrl}`;
  expect(problems.filter((problem) => problem !== expected404)).toEqual([]);
});
