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
  "localhost:3108",
  "localhost:3109",
  "localhost:8080",
  "fakes:8080",
]);

/**
 * Moves the server clock of a clock-controlled container forward (E2E_CLOCK_CONTROL, decision
 * D87), so a test creates a plan a minute or two ahead and then lets it start at once. The
 * browser and the test keep the real clock. Returns the server's new time.
 */
export async function advanceClock(baseURL: string, ms: number): Promise<Date> {
  const response = await fetch(new URL("/__e2e/clock/advance", baseURL), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ms }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`clock advance answered ${response.status}`);
  return new Date(((await response.json()) as { now: string }).now);
}

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
  options: {
    initScript?: () => void;
    context?: BrowserContextOptions;
    /** False for specs that read raw request headers: any route turns interception on. */
    stubGeocode?: boolean;
  } = {},
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
  // Tests share the app's geocode rate limit, and every tap in exact mode asks for a description
  // (decision D77): answered "nothing" here unless a test routes the request itself (a page route
  // wins over this one).
  // Not for a spec that inspects raw headers (v10-admin-ingress): with any route registered,
  // Chromium no longer reports the browser's own Sec-Fetch-Site in `request.allHeaders()`.
  if (options.stubGeocode !== false) {
    await context.route(
      (url) => url.pathname === "/geocode/describe",
      (route) => route.fulfill({ json: { label: null } }),
    );
  }
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

/** True once the full-screen map's zoom animation runs (checked every frame), false after 5 s. */
const ZOOM_ANIMATION_STARTS = `new Promise((resolve) => {
  const until = performance.now() + 5000;
  const check = () => {
    if (document.querySelector(".map-dialog .leaflet-zoom-anim") !== null) resolve(true);
    else if (performance.now() > until) resolve(false);
    else requestAnimationFrame(check);
  };
  check();
})`;

/** What moves the full-screen map just before it is closed: a key, or a wheel turn. */
export type MapMove = "ArrowRight" | "ArrowLeft" | "+" | "-" | "wheel in" | "wheel out";

/**
 * Closes the full-screen map with Escape while the move it just started still runs, once per move
 * (`open` opens it again each time): a pan at once, a zoom while its 250 ms animation runs. Leaflet
 * ends a zoom in a timer that removing the map does not cancel, and that timer threw "Cannot read
 * properties of undefined (reading '_leaflet_pos')" on the removed map (map-dialog.ts). Then no
 * page error may follow. Not the wheel in mobile WebKit, which Playwright cannot turn.
 */
export async function closeWhileTheMapMoves(
  page: Page,
  open: () => Promise<void>,
  moves: readonly MapMove[],
  problems: readonly string[],
): Promise<void> {
  const before = problems.length;
  const map = page.locator(".map-dialog .map-dialog-map");
  for (const move of moves) {
    await open();
    await expect(map).toBeFocused();
    if (move === "wheel in" || move === "wheel out") {
      const box = await map.boundingBox();
      await page.mouse.move(
        (box?.x ?? 0) + (box?.width ?? 0) / 2,
        (box?.y ?? 0) + (box?.height ?? 0) / 2,
      );
      await page.mouse.wheel(0, move === "wheel in" ? -300 : 300);
    } else {
      await page.keyboard.press(move);
    }
    // A zoom: closed only once its animation runs, inside the window the timer was left in.
    // Watched each frame in the page: polled from here, a slow engine could miss the 250 ms.
    // (waitForFunction would build a function from the text, which the app's CSP refuses.)
    if (move !== "ArrowRight" && move !== "ArrowLeft") {
      const zooming = await page.evaluate<boolean>(ZOOM_ANIMATION_STARTS);
      expect(zooming, `${move} starts a zoom animation`).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog.map-dialog")).toHaveCount(0);
  }
  // The timer runs 250 ms after its zoom started: by now the last one has run.
  await page.waitForTimeout(400);
  expect(problems.slice(before), "page errors after closing a moving map").toEqual([]);
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
