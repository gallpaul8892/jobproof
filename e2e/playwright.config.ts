import { defineConfig } from "@playwright/test";

// Chrome comes from PLAYWRIGHT_CHROMIUM_EXECUTABLE when set (see README.md); otherwise
// Playwright's own Chromium (`npx playwright install chromium`).
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: "./tests",
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
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
