import { expect, test, expectNoHorizontalOverflow, ManagerApi, signInViaApi } from "./support";
import type { Page } from "@playwright/test";

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

async function scrollCue(page: Page, table: string) {
  const wrap = page.getByTestId(table).locator("xpath=ancestor::div[contains(@class,'table-wrap')]");
  await expect(wrap).toHaveAttribute("role", "region");
  await expect(wrap).toHaveAttribute("tabindex", "0");
  const scrollable = await wrap.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(await wrap.getAttribute("data-scrollable")).toBe(String(scrollable));
  if (scrollable) await expect(page.getByTestId("scroll-hint")).toBeVisible();
  else await expect(page.getByTestId("scroll-hint")).toHaveCount(0);

  // The last column's cell (the "View report" link on billing, the billing badge on reports)
  // is fully visible once the table is scrolled to the end, and its text does not wrap.
  const cell = page.getByTestId(table).locator("tbody tr").first().locator("td").last();
  await wrap.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  const [box, wrapBox] = [await cell.boundingBox(), await wrap.boundingBox()];
  expect(box && wrapBox).toBeTruthy();
  expect(box!.x).toBeGreaterThanOrEqual(wrapBox!.x - 0.5);
  expect(box!.x + box!.width).toBeLessThanOrEqual(wrapBox!.x + wrapBox!.width + 0.5);
  const inner = cell.locator("a, .badge").first();
  await expect(inner).toBeVisible();
  expect((await inner.boundingBox())!.height).toBeLessThan(30);
  return scrollable;
}

test.describe("tables on tablet widths", () => {
  test("at 768px both tables show their last column and fit without a scroll", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await signInViaApi(page);
    await page.goto("/billing");
    await expect(page.getByTestId("invoices-table")).toBeVisible();
    expect(await scrollCue(page, "invoices-table")).toBe(false);
    await page.goto("/reports");
    await expect(page.getByTestId("reports-table")).toBeVisible();
    expect(await scrollCue(page, "reports-table")).toBe(false);
    await expect(page.getByTestId("reports-table").getByRole("columnheader", { name: "Billing" })).toBeVisible();
  });

  test("when a table is wider than its card the scroll is signalled and reachable", async ({ page }) => {
    await page.setViewportSize({ width: 520, height: 900 });
    await signInViaApi(page);
    await page.goto("/billing");
    await expect(page.getByTestId("invoices-table")).toBeVisible();
    expect(await scrollCue(page, "invoices-table")).toBe(true);
    await expect(page.getByTestId("scroll-hint")).toContainText("Scroll sideways");
    await page.goto("/reports");
    await expect(page.getByTestId("reports-table")).toBeVisible();
    expect(await scrollCue(page, "reports-table")).toBe(true);
    // the region is keyboard focusable and scrolls with the arrow keys
    const wrap = page.getByRole("region", { name: "Job reports" });
    await wrap.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => wrap.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  });
});
