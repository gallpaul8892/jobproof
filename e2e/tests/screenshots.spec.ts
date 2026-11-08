import { mkdirSync } from "node:fs";
import { expect, test, ADMIN, ManagerApi, signInViaApi } from "./support";

// Opt-in visual review: SCREENSHOT_DIR=/some/dir npx playwright test screenshots
const dir = process.env.SCREENSHOT_DIR;
test.skip(!dir, "set SCREENSHOT_DIR to capture screenshots");

const sizes = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 360, height: 800 },
];

for (const size of sizes) {
  test(`screenshots at ${size.name} width`, async ({ page, request }) => {
    mkdirSync(dir!, { recursive: true });
    await page.setViewportSize({ width: size.width, height: size.height });
    const shot = (name: string) => page.screenshot({ path: `${dir}/${name}-${size.name}.png`, fullPage: true });

    await page.goto("/login");
    await expect(page.getByTestId("demo-accounts")).toBeVisible();
    await shot("login");

    const api = await ManagerApi.create(request);
    const withPhotos = (await api.allReports()).find((r) => r.photo_count >= 6)!;
    await signInViaApi(page);
    await page.goto("/");
    await expect(page.getByTestId("recent-report-row")).toHaveCount(5);
    await shot("dashboard");

    await page.goto("/reports");
    await expect(page.getByTestId("reports-table")).toBeVisible();
    await shot("reports");

    await page.goto(`/reports/${withPhotos.id}`);
    await expect(page.getByTestId("photo-thumb").first().locator("img")).toBeVisible();
    await expect
      .poll(() => page.locator(".photo-img").evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).complete)))
      .toBe(true);
    await shot("report-detail");

    // an awaiting-review report: the review panel, the history and the edit form
    const awaiting = (await api.awaiting()).find((r) => r.photo_count >= 3)!;
    await page.goto(`/reports/${awaiting.id}`);
    await expect(page.getByTestId("mark-reviewed")).toBeVisible();
    await expect(page.getByTestId("history-empty")).toBeVisible();
    await expect
      .poll(() => page.locator(".photo-img").evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).complete)))
      .toBe(true);
    await shot("report-awaiting");
    await page.getByTestId("edit-report").click();
    await expect(page.getByTestId("edit-form")).toBeVisible();
    await page.getByLabel("Manager notes (internal)").fill("Chase the customer for sign-off before invoicing.");
    await shot("report-edit");

    // the customer page: details, reports, History and the edit form with the impact notice
    const customerId = withPhotos.customer.id;
    await page.goto(`/customers/${customerId}`);
    await expect(page.getByTestId("customer-report-row").first()).toBeVisible();
    await expect(page.getByTestId("history-empty")).toBeVisible();
    await shot("customer");
    await page.getByTestId("edit-customer").click();
    await expect(page.getByTestId("impact-notice")).toBeVisible();
    await shot("customer-edit");

    await page.goto(`/reports/${withPhotos.id}`);
    await page.getByTestId("photo-thumb").first().click();
    await expect(page.getByTestId("lightbox")).toBeVisible();
    await page.screenshot({ path: `${dir}/lightbox-${size.name}.png` });
    await page.keyboard.press("Escape");

    await page.goto("/billing");
    await expect(page.getByTestId("invoices-table")).toBeVisible();
    await shot("billing");
  });

  test(`admin settings screenshot at ${size.name} width`, async ({ page }) => {
    mkdirSync(dir!, { recursive: true });
    await page.setViewportSize({ width: size.width, height: size.height });
    await signInViaApi(page, ADMIN);
    await page.goto("/settings");
    await expect(page.getByTestId("settings-page")).toBeVisible();
    await expect(page.getByTestId("brand-name")).not.toBeEmpty();
    await page.screenshot({ path: `${dir}/admin-settings-${size.name}.png`, fullPage: true });
  });
}
