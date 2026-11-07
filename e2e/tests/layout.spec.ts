import { expect, test, expectNoHorizontalOverflow, ManagerApi, signInViaApi } from "./support";

// Responsive layout: no sideways page scroll from tablet (768px) down to phone (360px).
for (const width of [768, 360]) {
  test(`no horizontal page overflow at ${width}px`, async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const report = (await api.allReports()).find((r) => r.photo_count > 0)!;
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/login");
    await expectNoHorizontalOverflow(page);
    await signInViaApi(page);
    for (const [path, ready] of [
      ["/", "recent-reports-table"],
      ["/reports", "reports-table"],
      [`/reports/${report.id}`, "photo-thumb"],
      ["/billing", "invoices-table"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByTestId(ready).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  });
}

test("the main navigation marks the current page and is keyboard operable", async ({ page }) => {
  await signInViaApi(page);
  await page.goto("/reports");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Reports" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.getByRole("link", { name: "Billing" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/billing$/);
  await expect(page.getByRole("link", { name: "Billing" })).toHaveAttribute("aria-current", "page");
});
