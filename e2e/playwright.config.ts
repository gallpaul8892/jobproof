import { defineConfig } from "@playwright/test";

// Chrome comes from PLAYWRIGHT_CHROMIUM_EXECUTABLE when set (see README.md); otherwise
// Playwright's own Chromium (`npx playwright install chromium`).
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/global-setup.ts",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.WEB_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath,
      args: process.getuid?.() === 0 ? ["--no-sandbox"] : [],
    },
  },
  // Tests that change the company settings run after everything else and one at a time, so no
  // other test can see a half-changed theme or name. Each of them restores the defaults.
  projects: [
    { name: "chromium", use: { browserName: "chromium" }, testIgnore: /settings-writes\.spec\.ts/ },
    {
      name: "settings-writes",
      use: { browserName: "chromium" },
      testMatch: /settings-writes\.spec\.ts/,
      fullyParallel: false,
      dependencies: ["chromium"],
    },
  ],
});
