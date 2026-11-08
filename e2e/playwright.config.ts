import { defineConfig } from "@playwright/test";

// Chrome comes from PLAYWRIGHT_CHROMIUM_EXECUTABLE when set (see README.md); otherwise
// Playwright's own Chromium (`npx playwright install chromium`).
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

const WRITES = /(settings-writes|review|edit-report|history|customer-edit|edit-conflict-merge)\.spec\.ts/;

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
  // Tests that change data run after everything else, one project at a time and one test at a time,
  // so no other test can see a half-changed theme, name or report. Review and edit tests reseed the mock
  // data before each test (and once at the end); settings tests restore the defaults.
  projects: [
    { name: "chromium", use: { browserName: "chromium" }, testIgnore: WRITES },
    { name: "reviews", use: { browserName: "chromium" }, testMatch: /review\.spec\.ts/, fullyParallel: false, dependencies: ["chromium"] },
    { name: "edits", use: { browserName: "chromium" }, testMatch: /edit-report\.spec\.ts/, fullyParallel: false, dependencies: ["reviews"] },
    { name: "histories", use: { browserName: "chromium" }, testMatch: /history\.spec\.ts/, fullyParallel: false, dependencies: ["edits"] },
    { name: "customers", use: { browserName: "chromium" }, testMatch: /customer-edit\.spec\.ts/, fullyParallel: false, dependencies: ["histories"] },
    { name: "merges", use: { browserName: "chromium" }, testMatch: /edit-conflict-merge\.spec\.ts/, fullyParallel: false, dependencies: ["customers"] },
    {
      name: "settings-writes",
      use: { browserName: "chromium" },
      testMatch: /settings-writes\.spec\.ts/,
      fullyParallel: false,
      dependencies: ["merges"],
    },
  ],
});
