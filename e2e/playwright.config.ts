// End-to-end tests against the built image (spec 2b), on a phone-sized viewport.
// Locally, E2E_CHANNEL=chrome uses the installed Chrome instead of Playwright's Chromium.
import { defineConfig, devices } from "@playwright/test";

/** Specs that need the 0.7 to 0.9 configuration (admin, invites, logins, email, federation): the third container. */
const ACCOUNT_SPECS = /v0[789][^/]*\.spec\.ts$/;

/** The admin listener on its own port (0.10): the fourth container. */
const ADMIN_SPLIT_SPECS = /v10-admin-split\.spec\.ts$/;

/** The admin listener behind a fake Home Assistant Ingress (0.10 step 10b): the fifth container. */
const ADMIN_INGRESS_SPECS = /v10-admin-ingress\.spec\.ts$/;

/**
 * The specs that also run in WebKit (D72, plan I98): the layout specs and the ones that read
 * `/new` or `/styleguide` only. They create no plan, so they can share the default containers.
 */
const LAYOUT_SPECS = /(?:layout-phone|styleguide|styleguide-axe|field-style|map-pick)\.spec\.ts$/;

export default defineConfig({
  testDir: ".",
  globalSetup: "./global-setup.ts",
  timeout: 90_000,
  forbidOnly: process.env.CI === "true",
  // Repository root, where .gitignore and the CI artifact upload expect them.
  outputDir: "../test-results",
  reporter:
    process.env.CI === "true"
      ? [["list"], ["html", { open: "never", outputFolder: "../playwright-report" }]]
      : "list",
  use: {
    ...devices["Pixel 7"],
    ...(process.env.E2E_CHANNEL === undefined ? {} : { channel: process.env.E2E_CHANNEL }),
    // The fake providers are "fakes:8080" for the app containers and for the browser alike.
    launchOptions: { args: ["--host-resolver-rules=MAP fakes 127.0.0.1"] },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "default settings",
      testIgnore: [ACCOUNT_SPECS, ADMIN_SPLIT_SPECS, ADMIN_INGRESS_SPECS],
      use: { baseURL: "http://localhost:3101" },
    },
    {
      name: "maps, geocoder and weather disabled",
      testIgnore: [ACCOUNT_SPECS, ADMIN_SPLIT_SPECS, ADMIN_INGRESS_SPECS],
      use: { baseURL: "http://localhost:3102" },
    },
    // The layout specs again on WebKit against the default containers. The specs open their own
    // contexts (`person()`), so what makes it a phone is the explicit context viewport (320 and
    // 390 px), not the iPhone 13 device profile below. Needs `npx playwright install webkit` once. Playwright's WebKit is the desktop
    // engine, so iOS-native control quirks still need a phone (D72).
    {
      name: "webkit iPhone",
      testMatch: LAYOUT_SPECS,
      use: {
        ...devices["iPhone 13"],
        baseURL: "http://localhost:3101",
        // The Chromium-only launch arguments and channel do not apply; "fakes" is not used by the layout specs.
        channel: undefined,
        launchOptions: {},
      },
    },
    // Admin, invites and accounts (0.7), email (0.8) and federation (0.9) need their own configuration.
    {
      name: "0.7 to 0.9 features",
      testMatch: ACCOUNT_SPECS,
      use: { baseURL: "http://localhost:3103" },
    },
    {
      name: "0.10 admin listener",
      testMatch: ADMIN_SPLIT_SPECS,
      use: { baseURL: "http://localhost:3104" },
    },
    {
      name: "0.10 admin behind Ingress",
      testMatch: ADMIN_INGRESS_SPECS,
      use: { baseURL: "http://localhost:3106" },
    },
  ],
});
