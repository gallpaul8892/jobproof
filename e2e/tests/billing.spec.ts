import { expect, test, gbp, ManagerApi, showing, signInViaApi, type Page_ } from "./support";

interface Invoice {
  id: string;
  number: string;
  status: string;
  customer: { name: string };
  job_reference: string;
  report_id: string | null;
  total_pence: number;
  paid_pence: number;
  due_date: string | null;
}

test.describe("8. Billing overview", () => {
  test("paginated table with the API's total", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const first = await api.get<Page_<Invoice>>("invoices");
    expect(first.total).toBe(52);
    await signInViaApi(page);
    await page.goto("/billing");

    await expect(page.getByTestId("result-count")).toHaveText("Showing 1-20 of 52 invoices");
    await expect(page.getByTestId("invoices-table").getByRole("columnheader")).toHaveText([
      "Invoice no.",
      "Customer",
      "Job ref",
      "Amount",
      "Paid",
      "Due date",
      "Status",
      "Report",
    ]);
    const rows = page.getByTestId("invoices-table").locator("tbody tr");
    await expect(rows).toHaveCount(20);
    for (const [i, inv] of first.items.entries()) {
      const row = rows.nth(i);
      await expect(row).toContainText(inv.number);
      await expect(row).toContainText(inv.customer.name);
      await expect(row).toContainText(inv.job_reference);
      await expect(row.getByRole("cell").nth(3)).toHaveText(gbp(inv.total_pence));
      await expect(row.getByRole("cell").nth(4)).toHaveText(gbp(inv.paid_pence));
      if (inv.due_date === null) await expect(row.getByRole("cell").nth(5)).toHaveText("-");
      else await expect(row.getByRole("cell").nth(5)).toHaveText(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
    }
    // drafts have no due date and come first
    expect(first.items[0].status).toBe("draft");

    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByTestId("result-count")).toHaveText("Showing 21-40 of 52 invoices");
    await expect(page).toHaveURL(/\/billing\?page=2$/);
  });

  test("Overdue filter shows only overdue invoices, kept in the URL", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const overdue = await api.get<Page_<Invoice>>("invoices", { status: "overdue" });
    expect(overdue.total).toBeGreaterThan(0);
    await signInViaApi(page);
    await page.goto("/billing?page=2");
    await page.getByLabel("Status").selectOption({ label: "Overdue" });

    await expect(page).toHaveURL(/\/billing\?status=overdue$/);
    await expect(page.getByTestId("result-count")).toHaveText(showing(1, overdue.total, 20, "invoices"));
    const rows = page.getByTestId("invoices-table").locator("tbody tr");
    await expect(rows).toHaveCount(overdue.items.length);
    for (let i = 0; i < overdue.items.length; i++) await expect(rows.nth(i)).toContainText("Overdue");

    await page.reload();
    await expect(page.getByLabel("Status")).toHaveValue("overdue");
    await expect(page.getByTestId("result-count")).toHaveText(showing(1, overdue.total, 20, "invoices"));
  });

  test("every status filter matches the API count", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    await signInViaApi(page);
    await page.goto("/billing");
    for (const status of ["draft", "sent", "part_paid", "overdue", "paid", "void"]) {
      const expected = await api.get<Page_<Invoice>>("invoices", { status });
      await page.goto(`/billing?status=${status}`);
      await expect(page.getByTestId("result-count")).toHaveText(showing(1, expected.total, 20, "invoices"));
    }
  });

  test("View report opens that job's evidence page", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const paid = await api.get<Page_<Invoice>>("invoices", { status: "part_paid" });
    const inv = paid.items.find((i) => i.report_id)!;
    await signInViaApi(page);
    await page.goto("/billing?status=part_paid");
    const row = page.getByTestId("invoice-row").filter({ hasText: inv.number });
    await row.getByRole("link", { name: "View report" }).click();
    await expect(page).toHaveURL(new RegExp(`/reports/${inv.report_id}$`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(inv.job_reference);
    await expect(page.getByTestId("invoice-summary")).toContainText(inv.number);
    await expect(page.getByTestId("invoice-summary")).toContainText("Part paid");
  });
});
