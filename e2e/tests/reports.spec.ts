import {
  expect,
  test,
  ManagerApi,
  showing,
  signInViaApi,
  type Page_,
  type ReportItem,
} from "./support";

interface Painter {
  id: string;
  name: string;
}

test.describe("5. List job reports", () => {
  test("20 rows, newest first, with paging kept in the URL", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const first = await api.get<Page_<ReportItem>>("reports");
    expect(first.total).toBe(61); // 60 original reports + Priya's morning report (T-003c)
    await signInViaApi(page);
    await page.goto("/reports");

    const rows = page.getByTestId("reports-table").locator("tbody tr");
    await expect(rows).toHaveCount(20);
    await expect(page.getByTestId("result-count")).toHaveText("Showing 1-20 of 61 reports");
    await expect(page.getByTestId("page-label")).toHaveText("Page 1 of 4");

    const headers = page.getByTestId("reports-table").getByRole("columnheader");
    await expect(headers).toHaveText([
      "Job ref",
      "Customer",
      "Site address",
      "Operative",
      "Completed",
      "Photos",
      "Review",
      "Billing",
    ]);
    for (const [i, item] of first.items.entries()) {
      await expect(rows.nth(i).getByRole("link")).toHaveText(item.job_reference);
    }
    const r0 = first.items[0];
    await expect(rows.first()).toContainText(r0.customer.name);
    await expect(rows.first()).toContainText(r0.painter.name);
    await expect(rows.first()).toContainText(r0.site_address.postcode);
    await expect(rows.first().getByRole("cell").nth(5)).toHaveText(String(r0.photo_count));

    // Completed dates are newest first
    const dates = first.items.map((i) => i.completed_on);
    expect([...dates].sort().reverse()).toEqual(dates);

    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByTestId("result-count")).toHaveText("Showing 21-40 of 61 reports");
    await expect(page).toHaveURL(/\/reports\?page=2$/);
    const second = await api.get<Page_<ReportItem>>("reports", { page: 2 });
    await expect(rows.first().getByRole("link")).toHaveText(second.items[0].job_reference);

    await page.reload();
    await expect(page.getByTestId("result-count")).toHaveText("Showing 21-40 of 61 reports");

    await page.getByRole("button", { name: "Previous" }).click();
    await expect(page.getByTestId("result-count")).toHaveText("Showing 1-20 of 61 reports");
    await page.goBack();
    await expect(page.getByTestId("result-count")).toHaveText("Showing 21-40 of 61 reports");
  });

  test("the last page shows the remainder and disables Next", async ({ page }) => {
    await signInViaApi(page);
    await page.goto("/reports?page=4");
    await expect(page.getByTestId("result-count")).toHaveText("Showing 61-61 of 61 reports");
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});

test.describe("6. Filter and search reports", () => {
  test("search by customer name, postcode and job reference", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const all = await api.allReports();
    const sample = all[3];
    const word = sample.customer.name.split(/\s+/)[0];
    await signInViaApi(page);
    await page.goto("/reports?page=2");

    const search = page.getByRole("searchbox", { name: "Search" });
    const count = page.getByTestId("result-count");

    for (const term of [word.toUpperCase(), sample.site_address.postcode, sample.job_reference]) {
      await search.fill(term);
      const expected = await api.get<Page_<ReportItem>>("reports", { q: term });
      expect(expected.total).toBeGreaterThan(0);
      await expect(count).toHaveText(showing(1, expected.total, 20, "reports"));
      await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(term).replace(/%20/g, "(%20|\\+)")}`));
      await expect(page).not.toHaveURL(/page=/);
    }
    await expect(page.getByTestId("reports-table")).toContainText(sample.job_reference);
  });

  test("selects, painter and date range each filter, combine, and return to page 1", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const painters = await api.get<Painter[]>("painters");
    const dan = painters.find((p) => p.name === "Dan Hughes")!;
    await signInViaApi(page);
    await page.goto("/reports?page=3");
    const count = page.getByTestId("result-count");

    await page.getByLabel("Review status").selectOption("awaiting_review");
    let expected = await api.get<Page_<ReportItem>>("reports", { review_status: "awaiting_review" });
    await expect(count).toHaveText(showing(1, expected.total, 20, "reports"));
    await expect(page).toHaveURL(/review_status=awaiting_review/);
    await expect(page).not.toHaveURL(/page=/);
    const badges = page.getByTestId("reports-table").locator("tbody tr").getByText("Awaiting review");
    await expect(badges).toHaveCount(expected.items.length);

    await page.getByLabel("Billing status").selectOption("not_invoiced");
    expected = await api.get<Page_<ReportItem>>("reports", {
      review_status: "awaiting_review",
      billing_status: "not_invoiced",
    });
    await expect(count).toHaveText(showing(1, expected.total, 20, "reports"));

    await page.getByRole("button", { name: "Clear filters" }).first().click();
    await expect(count).toHaveText("Showing 1-20 of 61 reports");
    await expect(page).toHaveURL(/\/reports$/);

    await page.getByLabel("Operative").selectOption({ label: "Dan Hughes" });
    expected = await api.get<Page_<ReportItem>>("reports", { painter_id: dan.id });
    await expect(count).toHaveText(showing(1, expected.total, 20, "reports"));
    expect(expected.total).toBeGreaterThan(0);
    await expect(page).toHaveURL(new RegExp(`painter_id=${dan.id}`));

    const all = await api.allReports();
    const day = all[10].completed_on;
    await page.getByLabel("Operative").selectOption("");
    await page.getByLabel("Completed from").fill(day);
    await page.getByLabel("Completed to").fill(day);
    expected = await api.get<Page_<ReportItem>>("reports", { date_from: day, date_to: day });
    await expect(count).toHaveText(showing(1, expected.total, 20, "reports"));
    await expect(page).toHaveURL(new RegExp(`date_from=${day}&date_to=${day}`));
    expect(expected.items.every((i) => i.completed_on === day)).toBe(true);
  });

  test("filters in the URL are applied on load", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const expected = await api.get<Page_<ReportItem>>("reports", { billing_status: "overdue" });
    await signInViaApi(page);
    await page.goto("/reports?billing_status=overdue&review_status=bogus");
    await expect(page.getByLabel("Billing status")).toHaveValue("overdue");
    await expect(page.getByLabel("Review status")).toHaveValue("");
    await expect(page.getByTestId("result-count")).toHaveText(showing(1, expected.total, 20, "reports"));
  });

  test("no matches shows the empty state, and Clear filters restores all 61", async ({ page }) => {
    await signInViaApi(page);
    await page.goto("/reports");
    await page.getByRole("searchbox", { name: "Search" }).fill("zzzz-no-such-thing");
    const empty = page.getByTestId("empty-state");
    await expect(empty).toContainText("No reports match these filters");
    await expect(page.getByTestId("reports-table")).toHaveCount(0);
    await empty.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByTestId("result-count")).toHaveText("Showing 1-20 of 61 reports");
    await expect(page.getByRole("searchbox", { name: "Search" })).toHaveValue("");
    await expect(page).toHaveURL(/\/reports$/);
  });

  test("wildcard characters are searched literally", async ({ page }) => {
    await signInViaApi(page);
    await page.goto("/reports");
    await page.getByRole("searchbox", { name: "Search" }).fill("%");
    await expect(page.getByTestId("empty-state")).toContainText("No reports match these filters");
  });
});
