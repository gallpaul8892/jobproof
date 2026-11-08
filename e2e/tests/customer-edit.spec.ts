import type { Page } from "@playwright/test";
import {
  ADMIN,
  MANAGER,
  MANAGER2,
  PAINTER,
  expect,
  test,
  ManagerApi,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  londonTime,
  reseed,
  signInViaApi,
  type ReportItem,
} from "./support";

// These tests edit customers, so each starts from a fresh seed (see playwright.config.ts).
test.beforeEach(() => reseed());
test.afterAll(() => reseed());

const HARBOURSIDE = "Harbourside Lettings Ltd";

/** Harbourside's customer id, found through the reports list (there is no customers list). */
async function harbourside(api: ManagerApi): Promise<{ id: string; reports: ReportItem[] }> {
  const all = await api.allReports();
  const id = all.find((r) => r.customer.name === HARBOURSIDE)!.customer.id;
  return { id, reports: await api.reportsOf(id) };
}

const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const save = (page: Page) => page.getByRole("button", { name: "Save changes" });

test.describe("T-002n: customer page and edits", () => {
  test("opens from a report's Customer section and shows the details, reports and History", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const { id, reports } = await harbourside(api);
    const customer = await api.customer(id);
    await signInViaApi(page);
    await page.goto(`/reports/${reports[0]!.id}`);
    await page.getByTestId("customer").getByRole("link", { name: HARBOURSIDE }).click();

    await expect(page).toHaveURL(new RegExp(`/customers/${id}$`));
    await expect(page.getByRole("heading", { level: 1, name: HARBOURSIDE })).toBeVisible();
    await expect(page.getByTestId("customer-email")).toHaveText(customer.email ?? "-");
    await expect(page.getByTestId("customer-phone")).toHaveText(customer.phone ?? "-");
    const a = customer.billing_address;
    await expect(page.getByTestId("customer-address")).toContainText(a.line1);
    await expect(page.getByTestId("customer-address")).toContainText(a.postcode);
    await expect(page.getByTestId("customer-report-row")).toHaveCount(reports.length);
    await expect(page.getByTestId("history-empty")).toBeVisible();
    await expectNoAxeViolations(page, "customer page");

    // back goes to the report it was opened from
    await page.getByTestId("back-link").click();
    await expect(page).toHaveURL(new RegExp(`/reports/${reports[0]!.id}$`));
  });

  test("the report's Edit customer details link opens the page in edit mode", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const { reports } = await harbourside(api);
    await signInViaApi(page);
    await page.goto(`/reports/${reports[0]!.id}`);
    await page.getByRole("link", { name: "Edit customer details" }).click();
    await expect(page.getByTestId("edit-customer-form")).toBeVisible();
  });

  test("correcting the phone saves, bumps the version and writes a before/after history entry", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const { id } = await harbourside(api);
    const before = await api.customer(id);
    await signInViaApi(page, MANAGER);
    await page.goto(`/customers/${id}`);
    await page.getByRole("button", { name: "Edit details" }).click();
    await expect(save(page)).toBeDisabled();
    await expectNoAxeViolations(page, "customer edit form");
    await field(page, "Phone").fill("0117 496 0123");
    await save(page).click();

    await expect(page.getByTestId("edit-saved")).toHaveText("Changes saved");
    await expect(page.getByTestId("customer-phone")).toHaveText("0117 496 0123");
    const after = await api.customer(id);
    expect(after.version).toBe(before.version + 1);
    expect(after.last_changed_by?.name).toBe(MANAGER.name);
    await expect(page.getByTestId("history-sentence").first()).toHaveText("Sarah Whitfield changed customer details: Phone");
    await expect(page.getByTestId("history-before").first()).toHaveText(before.phone ?? "(empty)");
    await expect(page.getByTestId("history-after").first()).toHaveText("0117 496 0123");
    const events = await api.customerHistory(id);
    expect(events).toHaveLength(1);
    expect(events[0]!.customer_id).toBe(id);
  });

  test("the impact notice matches the counts from the API and is shown before saving", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const { id } = await harbourside(api);
    const { impact } = await api.customer(id);
    await signInViaApi(page);
    await page.goto(`/customers/${id}`);
    await page.getByRole("button", { name: "Edit details" }).click();
    const noun = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const parts = [
      noun(impact.job_count, "job", "jobs"),
      `${noun(impact.report_count, "report", "reports")}${impact.reviewed_report_count ? ` (${impact.reviewed_report_count} reviewed)` : ""}`,
      noun(impact.issued_invoice_count, "issued invoice", "issued invoices"),
    ];
    const text = `These details are used on ${parts[0]}, ${parts[1]} and ${parts[2]}. Changes will show on all of them. Reviewed reports stay reviewed.`;
    const notice = page.getByTestId("impact-notice");
    await expect(notice).toHaveText(text);
    await expect(notice).toHaveAttribute("role", "status");
  });

  test("a customer edit shows in every Harbourside report's History, without reopening a reviewed one", async ({ page, request }) => {
    const sarahApi = await ManagerApi.create(request);
    const { id, reports } = await harbourside(sarahApi);
    const target = reports.find((r) => r.review_status === "reviewed");
    if (!target) throw new Error("expected a reviewed Harbourside report in the seed");
    const reportBefore = await sarahApi.get<{ version: number; review_status: string; reviewed_by: { name: string } | null }>(
      `reports/${target.id}`,
    );
    const awaitingBefore = (await sarahApi.awaiting()).length;

    await signInViaApi(page, MANAGER2);
    await page.goto(`/customers/${id}`);
    await page.getByRole("button", { name: "Edit details" }).click();
    await field(page, "Email").fill("  accounts@harbourside.example.co.uk ");
    await save(page).click();
    await expect(page.getByTestId("edit-saved")).toHaveText("Changes saved");

    // the reviewed report: still reviewed, same version, entry with the Customer tag, new email in its Customer section
    await page.goto(`/reports/${target.id}`);
    await expect(page.getByText("Reviewed", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("history-sentence").first()).toHaveText("Priya Nair changed customer details: Email");
    const entry = page.getByTestId("history-event").first();
    await expect(entry.getByTestId("history-customer-tag")).toHaveText("Customer");
    await expect(entry.getByTestId("history-after")).toHaveText("accounts@harbourside.example.co.uk");
    await expect(page.getByTestId("customer")).toContainText("accounts@harbourside.example.co.uk");
    await entry.getByRole("link", { name: "View customer" }).click();
    await expect(page).toHaveURL(new RegExp(`/customers/${id}$`));

    const reportAfter = await sarahApi.get<typeof reportBefore>(`reports/${target.id}`);
    expect(reportAfter.version).toBe(reportBefore.version);
    expect(reportAfter.review_status).toBe(reportBefore.review_status);
    expect(reportAfter.reviewed_by?.name).toBe(reportBefore.reviewed_by?.name);
    expect((await sarahApi.awaiting()).length).toBe(awaitingBefore);

    // the same event is in the history of every Harbourside report and in none of another customer's
    const customerEvent = (await sarahApi.customerHistory(id))[0]!;
    for (const r of reports) {
      expect((await sarahApi.history(r.id)).map((e) => e.id)).toContain(customerEvent.id);
    }
    const other = (await sarahApi.allReports()).find((r) => r.customer.id !== id)!;
    expect((await sarahApi.history(other.id)).map((e) => e.id)).not.toContain(customerEvent.id);
  });

  test("tolerant input is normalised; bad input is refused beside the field and nothing is saved", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const { id } = await harbourside(api);
    const before = await api.customer(id);
    await signInViaApi(page);
    await page.goto(`/customers/${id}`);
    await page.getByRole("button", { name: "Edit details" }).click();

    await field(page, "Postcode").fill("BS1");
    await field(page, "Phone").fill("12345");
    await field(page, "Email").fill("accounts at harbourside");
    await expect(page.getByTestId("postcode-error")).toHaveText("Enter a UK postcode such as BS6 5QA.");
    await expect(page.getByTestId("phone-error")).toHaveText(
      "Enter a UK phone number such as 07700 900123.",
    );
    await expect(page.getByTestId("email-error")).toHaveText("Enter an email address such as name@example.co.uk.");
    await expect(save(page)).toBeDisabled();
    await expectNoAxeViolations(page, "customer edit form with errors");
    expect((await api.customer(id)).version).toBe(before.version);

    await field(page, "Postcode").fill("bs1 4sb");
    await field(page, "Phone").fill("+44 (0)117 496 0123");
    await field(page, "Email").fill(" accounts@harbourside.example.co.uk ");
    await save(page).click();
    await expect(page.getByTestId("edit-saved")).toHaveText("Changes saved");
    const after = await api.customer(id);
    expect(after.billing_address.postcode).toBe("BS1 4SB");
    expect(after.phone).toBe("+44 (0)117 496 0123");
    expect(after.email).toBe("accounts@harbourside.example.co.uk");
  });

  test("optional fields can be cleared and show as '-', required ones cannot", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const { id } = await harbourside(api);
    await signInViaApi(page);
    await page.goto(`/customers/${id}`);
    await page.getByRole("button", { name: "Edit details" }).click();
    for (const label of ["Contact name", "Email", "Phone", "Address line 2", "County"]) await field(page, label).fill("");
    await field(page, "Name").fill("");
    await expect(page.getByTestId("name-error")).toHaveText("Enter a name.");
    await expect(save(page)).toBeDisabled();
    await field(page, "Name").fill(HARBOURSIDE);
    await save(page).click();
    await expect(page.getByTestId("edit-saved")).toHaveText("Changes saved");
    for (const t of ["customer-contact", "customer-email", "customer-phone"]) await expect(page.getByTestId(t)).toHaveText("-");
    const after = await api.customer(id);
    expect([after.contact_name, after.email, after.phone, after.billing_address.line2, after.billing_address.county]).toEqual([
      null, null, null, null, null,
    ]);
  });

  test("two managers: the second save is refused with the saved value beside the field", async ({ browser, request }) => {
    const api = await ManagerApi.create(request);
    const { id } = await harbourside(api);
    const sarah = await (await browser.newContext()).newPage();
    const priya = await (await browser.newContext()).newPage();
    await signInViaApi(sarah, MANAGER);
    await signInViaApi(priya, MANAGER2);
    await sarah.goto(`/customers/${id}`);
    await priya.goto(`/customers/${id}`);
    await sarah.getByRole("button", { name: "Edit details" }).click();
    await priya.getByRole("button", { name: "Edit details" }).click();

    await field(sarah, "Phone").fill("0117 496 0123");
    await save(sarah).click();
    await expect(sarah.getByTestId("edit-saved")).toHaveText("Changes saved");
    const afterSarah = await api.customer(id);

    await field(priya, "Email").fill("priya@harbourside.example.co.uk");
    await save(priya).click();
    await expect(priya.getByTestId("edit-conflict")).toContainText(
      `Sarah Whitfield changed this customer at ${londonTime(afterSarah.last_changed_at!)}. Your changes were not saved.`,
    );
    await expect(field(priya, "Email")).toHaveValue("priya@harbourside.example.co.uk");
    await expect(priya.getByTestId("email-current")).toContainText("Current saved value:");
    await expect(priya.getByTestId("email-current")).toContainText(afterSarah.email ?? "(empty)");
    await expect(priya.getByRole("button", { name: "Apply my changes on top" })).toBeVisible();
    await expect(priya.getByRole("button", { name: "Reload latest" })).toBeVisible();
    await expectNoAxeViolations(priya, "customer edit conflict");
    const now = await api.customer(id);
    expect(now.version).toBe(afterSarah.version);
    expect(now.email).toBe(afterSarah.email);
    expect(await api.customerHistory(id)).toHaveLength(1);

    // Reload latest still discards
    await priya.getByRole("button", { name: "Reload latest" }).click();
    await priya.getByRole("dialog").getByRole("button", { name: "Discard and reload" }).click();
    await expect(field(priya, "Phone")).toHaveValue("0117 496 0123");
    await expect(field(priya, "Email")).toHaveValue(afterSarah.email ?? "");
    await expect(priya.getByTestId("edit-conflict")).toHaveCount(0);
  });

  test("an admin and a painter see the not-authorised page and no customer request is made", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const { id } = await harbourside(api);
    const seen: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/v1/manager/customers")) seen.push(r.url());
    });
    for (const who of [ADMIN, PAINTER]) {
      await signInViaApi(page, who);
      await page.goto(`/customers/${id}`);
      await expect(page.getByRole("heading", { name: /This page is for/ })).toBeVisible();
      await page.evaluate(() => sessionStorage.clear());
    }
    expect(seen).toEqual([]);
  });

  test("an unknown customer shows a not-found page", async ({ page }) => {
    await signInViaApi(page);
    await page.goto("/customers/00000000-0000-4000-8000-000000000000");
    await expect(page.getByTestId("not-found")).toBeVisible();
  });

  test("markup in a name is shown literally everywhere, long values wrap at 360px", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const { id, reports } = await harbourside(api);
    const name = '<b>Smith</b> & "Sons"';
    await api.editCustomer(id, { name, billing_address: { line1: "w".repeat(100) } });
    await page.setViewportSize({ width: 360, height: 800 });
    await signInViaApi(page);
    await page.goto(`/customers/${id}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    expect(await page.locator("h1 b").count()).toBe(0);
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "Edit details" }).click();
    await expect(field(page, "Name")).toHaveValue(name);
    await expectNoHorizontalOverflow(page);
    await page.goto(`/reports/${reports[0]!.id}`);
    await expect(page.getByTestId("customer")).toContainText(name);
    await expect(page.getByTestId("history-sentence").first()).toContainText("changed customer details: Customer name, Billing address line 1");
    await expectNoHorizontalOverflow(page);
    expect(await page.locator("main b").count()).toBe(0);
  });

  test("a lost reply after the server saved is treated as saved, with no duplicate entry", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const { id } = await harbourside(api);
    await signInViaApi(page);
    let first = true;
    await page.route(new RegExp(`/manager/customers/${id}$`), async (route) => {
      if (route.request().method() === "PATCH" && first) {
        first = false;
        await route.fetch();
        return route.abort("failed");
      }
      return route.continue();
    });
    await page.goto(`/customers/${id}`);
    await page.getByRole("button", { name: "Edit details" }).click();
    await field(page, "County").fill("Somerset");
    await save(page).click();
    await expect(page.getByTestId("edit-failure")).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("edit-saved")).toHaveText("Changes saved");
    await expect(page.getByTestId("edit-conflict")).toHaveCount(0);
    expect(await api.customerHistory(id)).toHaveLength(1);
  });
});

