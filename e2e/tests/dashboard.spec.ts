import { expect, test, gbp, ManagerApi, showing, signInViaApi, type ReportItem } from "./support";

interface Dashboard {
  period_start: string;
  reports_awaiting_review: number;
  jobs_completed_this_month: number;
  invoiced_this_month_pence: number;
  outstanding_pence: number;
  overdue_invoice_count: number;
  recent_reports: ReportItem[];
}

test.describe("4. Dashboard summary", () => {
  test("shows the API's figures, recent reports and working links", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const d = await api.get<Dashboard>("dashboard");
    await signInViaApi(page);
    await page.goto("/");

    await expect(page.getByTestId("stat-awaiting-review")).toContainText(String(d.reports_awaiting_review));
    await expect(page.getByTestId("stat-completed-month")).toContainText(String(d.jobs_completed_this_month));
    await expect(page.getByTestId("stat-invoiced-month")).toContainText(gbp(d.invoiced_this_month_pence));
    await expect(page.getByTestId("stat-outstanding")).toContainText(gbp(d.outstanding_pence));
    await expect(page.getByTestId("stat-overdue")).toContainText(String(d.overdue_invoice_count));
    expect(gbp(d.outstanding_pence)).toMatch(/^£[\d,]+\.\d{2}$/);

    const month = new Date(`${d.period_start}T00:00:00Z`).toLocaleDateString("en-GB", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    await expect(page.getByTestId("period-label")).toHaveText(month);

    const rows = page.getByTestId("recent-report-row");
    await expect(rows).toHaveCount(5);
    expect(d.recent_reports).toHaveLength(5);
    for (const [i, report] of d.recent_reports.entries()) {
      await expect(rows.nth(i)).toContainText(report.job_reference);
      await expect(rows.nth(i).getByRole("link")).toHaveAttribute("href", `/reports/${report.id}`);
    }

    await rows.first().getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/reports/${d.recent_reports[0].id}$`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(d.recent_reports[0].job_reference);
  });

  test("Reports awaiting review opens the filtered list with the same count", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const d = await api.get<Dashboard>("dashboard");
    await signInViaApi(page);
    await page.goto("/");
    await page.getByTestId("stat-awaiting-review").click();
    await expect(page).toHaveURL(/\/reports\?review_status=awaiting_review$/);
    await expect(page.getByLabel("Review status")).toHaveValue("awaiting_review");
    await expect(page.getByTestId("result-count")).toHaveText(
      showing(1, d.reports_awaiting_review, 20, "reports"),
    );
  });

  test("Outstanding and Overdue open billing", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const d = await api.get<Dashboard>("dashboard");
    await signInViaApi(page);
    await page.goto("/");
    await page.getByTestId("stat-overdue").click();
    await expect(page).toHaveURL(/\/billing\?status=overdue$/);
    await expect(page.getByTestId("result-count")).toHaveText(showing(1, d.overdue_invoice_count, 20, "invoices"));
    await page.goBack();
    await page.getByTestId("stat-outstanding").click();
    await expect(page).toHaveURL(/\/billing$/);
  });
});
