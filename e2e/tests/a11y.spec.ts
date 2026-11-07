import AxeBuilder from "@axe-core/playwright";
import { expect, test, ADMIN, ManagerApi, expectNoContrastViolations, signInViaApi } from "./support";

test.describe("T-002d scenario 5: colour contrast (axe) with the default theme", () => {
  test("login", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("demo-accounts")).toBeVisible();
    await expect(page.getByTestId("login-heading")).not.toBeEmpty();
    await expectNoContrastViolations(page, "login");
  });

  test("dashboard, reports, report detail and billing", async ({ page, request }) => {
    const report = (await (await ManagerApi.create(request)).allReports()).find((r) => r.photo_count > 0)!;
    await signInViaApi(page);
    for (const [path, ready] of [
      ["/", "recent-report-row"],
      ["/reports", "reports-table"],
      [`/reports/${report.id}`, "photo-thumb"],
      ["/billing", "invoices-table"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByTestId(ready).first()).toBeVisible();
      await expectNoContrastViolations(page, path);
    }
  });

  test("settings and the not-authorised page", async ({ page }) => {
    await signInViaApi(page, ADMIN);
    await page.goto("/settings");
    await expect(page.getByTestId("settings-page")).toBeVisible();
    await expectNoContrastViolations(page, "settings");
    await page.goto("/reports");
    await expect(page.getByTestId("not-authorised")).toBeVisible();
    await expectNoContrastViolations(page, "not-authorised");
  });

  test("the settings page has no other serious accessibility violations", async ({ page }) => {
    await signInViaApi(page, ADMIN);
    await page.goto("/settings");
    await expect(page.getByTestId("settings-page")).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
});
