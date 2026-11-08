// End-to-end tests against the built image (spec 2b), on a phone-sized viewport.
// Locally, E2E_CHANNEL=chrome uses the installed Chrome instead of Playwright's Chromium.
import { defineConfig, devices } from "@playwright/test";

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
    { name: "default settings", use: { baseURL: "http://localhost:3101" } },
    { name: "maps, geocoder and weather disabled", use: { baseURL: "http://localhost:3102" } },
  ],
});
