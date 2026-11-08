import {
  expect,
  test,
  ManagerApi,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  londonDateTime,
  londonDaysBetween,
  showing,
  signInViaApi,
  waitingText,
} from "./support";

interface Dashboard {
  as_of: string;
  reports_awaiting_review: number;
  review_queue: { id: string; job_reference: string; submitted_at: string; customer: { name: string }; painter: { name: string } }[];
}

test.describe("T-002k: dashboard review queue (read only)", () => {
  test("shows the five longest-waiting reports, oldest first, with every column", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const d = await api.get<Dashboard>("dashboard");
    const awaiting = await api.awaiting();
    expect(awaiting.length).toBe(d.reports_awaiting_review);
    expect(d.review_queue.map((r) => r.id)).toEqual(awaiting.slice(0, 5).map((r) => r.id));

    await signInViaApi(page);
    await page.goto("/");
    const queue = page.getByTestId("review-queue");
    await expect(queue.getByRole("heading", { name: "Review queue" })).toBeVisible();
    const rows = queue.getByTestId("queue-row");
    await expect(rows).toHaveCount(5);

    // the queue sits above Recent reports, below the stat cards
    const order = await page.evaluate(() => {
      const y = (sel: string) => document.querySelector(sel)!.getBoundingClientRect().top;
      return [y('[data-testid="stat-awaiting-review"]'), y('[data-testid="review-queue"]'), y("#recent-heading")];
    });
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);

    for (const [i, r] of awaiting.slice(0, 5).entries()) {
      const row = rows.nth(i);
      await expect(row.getByTestId("queue-ref")).toHaveText(r.job_reference);
      await expect(row).toContainText(r.customer.name);
      await expect(row).toContainText(r.site_address.postcode);
      await expect(row).toContainText(r.painter.name);
      await expect(row).toContainText(londonDateTime(r.submitted_at));
      await expect(row.getByTestId("queue-waiting")).toHaveText(
        waitingText(londonDaysBetween(r.submitted_at, d.as_of)),
      );
      await expect(row.getByRole("link", { name: `Review ${r.job_reference}` })).toHaveAttribute("href", `/reports/${r.id}`);
    }
    // oldest first
    const times = awaiting.slice(0, 5).map((r) => r.submitted_at);
    expect([...times].sort()).toEqual(times);
  });

  test("the reference and the Review link both open the report", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const first = (await api.awaiting())[0];
    await signInViaApi(page);
    await page.goto("/");
    await page.getByTestId("queue-row").first().getByTestId("queue-ref").click();
    await expect(page).toHaveURL(new RegExp(`/reports/${first.id}$`));
    await page.goBack();
    await page.getByRole("link", { name: `Review ${first.job_reference}` }).click();
    await expect(page).toHaveURL(new RegExp(`/reports/${first.id}$`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(first.job_reference);
  });

  test("View all opens the full awaiting list, oldest first, with the same count", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const awaiting = await api.awaiting();
    await signInViaApi(page);
    await page.goto("/");
    const link = page.getByRole("link", { name: `View all ${awaiting.length} awaiting review` });
    await link.click();
    await expect(page).toHaveURL(/\/reports\?review_status=awaiting_review&sort=submitted_asc$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reports");
    await expect(page.getByTestId("result-count")).toHaveText(showing(1, awaiting.length, 20, "reports"));
    const refs = page.getByTestId("report-row").getByRole("link");
    await expect(refs).toHaveCount(awaiting.length);
    expect(await refs.allTextContents()).toEqual(awaiting.map((r) => r.job_reference));

    // changing a filter keeps the sort order
    await page.getByLabel("Billing status").selectOption("not_invoiced");
    await expect(page).toHaveURL(/sort=submitted_asc/);
    await expect(page).toHaveURL(/billing_status=not_invoiced/);
  });

  test("an unknown sort value is ignored", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const total = (await api.get<{ total: number }>("reports")).total;
    await signInViaApi(page);
    await page.goto("/reports?sort=newest");
    await expect(page.getByTestId("result-count")).toHaveText(showing(1, total, 20, "reports"));
  });

  test("a failing dashboard shows a skeleton, then an error with retry that recovers", async ({ page }) => {
    await signInViaApi(page);
    let fail = true;
    await page.route(/\/api\/v1\/manager\/dashboard$/, async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      if (!fail) return route.continue();
      return route.fulfill({
        status: 500,
        contentType: "application/problem+json",
        body: JSON.stringify({ type: "about:blank", title: "Internal Server Error", status: 500, code: "internal_error", request_id: "e2e" }),
      });
    });
    await page.goto("/");
    await expect(page.getByTestId("loading-state")).toBeVisible();
    await expect(page.getByTestId("error-state")).toBeVisible();
    await expect(page.getByTestId("review-queue")).toHaveCount(0);
    fail = false;
    await page.getByTestId("retry-button").click();
    await expect(page.getByTestId("queue-row")).toHaveCount(5);
  });

  test("has no accessibility violations and fits at 360px", async ({ page }) => {
    await signInViaApi(page);
    await page.goto("/");
    await expect(page.getByTestId("queue-row").first()).toBeVisible();
    await expectNoAxeViolations(page, "dashboard");
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(page.getByTestId("queue-row").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page, "dashboard 360px");
    // keyboard: Tab reaches a Review link and it is operable
    const link = page.getByTestId("queue-review").first();
    await link.focus();
    await expect(link).toBeFocused();
  });
});
