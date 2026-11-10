// Shared by the end-to-end specs.
import type { Browser, BrowserContext } from "@playwright/test";

/** A date five days from now, as the date field expects it: within the weather horizon. */
export const inFiveDays = () =>
  new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const ALLOWED_HOSTS = new Set(["localhost:3101", "localhost:3102", "localhost:3103", "fakes:8080"]);

/** A browser profile of its own (own cookies), failing the test on console errors or foreign requests. */
export async function person(
  browser: Browser,
  baseURL: string,
  problems: string[],
  options: { initScript?: () => void } = {},
) {
  const context: BrowserContext = await browser.newContext({ baseURL });
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
