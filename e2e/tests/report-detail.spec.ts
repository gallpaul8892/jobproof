import {
  expect,
  test,
  ManagerApi,
  expectMainHasText,
  expectNoHorizontalOverflow,
  gbp,
  signInViaApi,
  UNKNOWN_ID,
  type Page_,
  type ReportItem,
} from "./support";

interface Photo {
  id: string;
  stage: "before" | "during" | "after";
  caption: string;
  thumb_url: string;
  url: string;
}
interface Detail {
  id: string;
  painter_notes: string | null;
  photos: Photo[];
  job: { reference: string; title: string; notes: string | null; site_address: { line1: string; line2: string | null; postcode: string } };
  customer: { name: string; email: string | null; job_count: number };
  painter: { name: string };
  checklist: { label: string; done: boolean; note: string | null }[];
  quote: { reference: string; total_pence: number; deposit_pence: number } | null;
  invoice: { number: string; total_pence: number; paid_pence: number; balance_pence: number } | null;
  payments: { amount_pence: number }[];
}

async function detailFor(api: ManagerApi, item: ReportItem): Promise<Detail> {
  return api.get<Detail>(`reports/${item.id}`);
}

test.describe("7. View evidence for a report", () => {
  test("shows every section for a report with photos and an invoice", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const all = await api.allReports();
    const withPhotos = all.filter((r) => r.photo_count >= 4 && r.billing_status === "paid");
    expect(withPhotos.length).toBeGreaterThan(0);
    const item = withPhotos[0];
    const d = await detailFor(api, item);

    await signInViaApi(page);
    await page.goto("/reports");
    await page.getByRole("searchbox", { name: "Search" }).fill(item.job_reference);
    await page.getByRole("link", { name: item.job_reference }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${d.job.reference} · ${d.job.title}`);
    await expect(page.getByTestId("job-details")).toBeVisible();
    await expect(page.getByTestId("site-address")).toContainText(d.job.site_address.postcode);
    await expect(page.getByTestId("customer")).toContainText(d.customer.name);
    await expect(page.getByTestId("customer")).toContainText(`${d.customer.job_count} ${d.customer.job_count === 1 ? "job" : "jobs"} with us`);
    await expect(page.getByTestId("painter")).toContainText(d.painter.name);
    if (d.painter_notes) await expect(page.getByTestId("painter-notes")).toContainText(d.painter_notes.slice(0, 40));

    const checklist = page.getByTestId("checklist");
    for (const c of d.checklist) await expect(checklist).toContainText(c.label);
    for (const c of d.checklist.filter((c) => !c.done)) {
      await expect(checklist).toContainText("Not done");
      if (c.note) await expect(checklist).toContainText(c.note);
    }

    // Photos grouped Before, During, After with counts, in API order
    for (const stage of ["before", "during", "after"] as const) {
      const expected = d.photos.filter((p) => p.stage === stage);
      const group = page.getByTestId(`photos-${stage}`);
      await expect(group.getByRole("heading")).toContainText(`(${expected.length})`);
      await expect(group.getByTestId("photo-thumb")).toHaveCount(expected.length);
      for (const [i, p] of expected.entries()) {
        const thumb = group.getByTestId("photo-thumb").nth(i);
        await expect(thumb).toContainText(p.caption);
        await expect(thumb).toContainText(/\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}/);
      }
    }
    await expect(page.getByTestId("photos-before").getByRole("heading")).toContainText("Before");
    // thumbnails actually load from the API
    await expect
      .poll(() =>
        page.getByTestId("photo-thumb").first().locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
      )
      .toBe(true);

    // Billing
    const billing = page.getByTestId("billing");
    if (d.quote) {
      await expect(billing).toContainText(d.quote.reference);
      await expect(billing).toContainText(gbp(d.quote.total_pence));
    }
    expect(d.invoice).not.toBeNull();
    await expect(billing).toContainText(d.invoice!.number);
    await expect(page.getByTestId("invoice-summary")).toContainText(gbp(d.invoice!.total_pence));
    await expect(page.getByTestId("invoice-summary")).toContainText(gbp(d.invoice!.paid_pence));
    await expect(page.getByTestId("invoice-summary")).toContainText("Paid");
    const paymentRows = page.getByTestId("payments-table").locator("tbody tr");
    await expect(paymentRows).toHaveCount(d.payments.length);
    for (const [i, p] of d.payments.entries()) await expect(paymentRows.nth(i)).toContainText(gbp(p.amount_pence));
  });

  test("lightbox: open, navigate with keys and buttons, Escape closes and focus returns", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const item = (await api.allReports()).find((r) => r.photo_count >= 4)!;
    const d = await detailFor(api, item);
    await signInViaApi(page);
    await page.goto(`/reports/${item.id}`);

    const thumbs = page.getByTestId("photo-thumb");
    await expect(thumbs).toHaveCount(d.photos.length);
    const lightbox = page.getByTestId("lightbox");
    const position = page.getByTestId("lightbox-position");
    await expect(lightbox).toBeHidden();

    const opener = thumbs.nth(1);
    await opener.focus();
    await page.keyboard.press("Enter");
    await expect(lightbox).toBeVisible();
    await expect(lightbox).toHaveAttribute("open", "");
    await expect(position).toHaveText(`2 of ${d.photos.length}`);
    await expect(page.getByTestId("lightbox-caption")).toHaveText(d.photos[1].caption);
    const img = lightbox.getByRole("img", { name: d.photos[1].caption });
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    await expect(lightbox).toContainText(/\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}/);

    await page.keyboard.press("ArrowRight");
    await expect(position).toHaveText(`3 of ${d.photos.length}`);
    await expect(page.getByTestId("lightbox-caption")).toHaveText(d.photos[2].caption);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(position).toHaveText(`1 of ${d.photos.length}`);
    await page.keyboard.press("ArrowLeft");
    await expect(position).toHaveText(`${d.photos.length} of ${d.photos.length}`);

    await lightbox.getByRole("button", { name: "Next photo" }).click();
    await expect(position).toHaveText(`1 of ${d.photos.length}`);
    await lightbox.getByRole("button", { name: "Previous photo" }).click();
    await expect(position).toHaveText(`${d.photos.length} of ${d.photos.length}`);

    await page.keyboard.press("Escape");
    await expect(lightbox).toBeHidden();
    await expect(opener).toBeFocused();

    // The Close button also returns focus
    await opener.click();
    await expect(lightbox).toBeVisible();
    await lightbox.getByRole("button", { name: "Close" }).click();
    await expect(lightbox).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("a report with no photos says so", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const empty = (await api.allReports()).filter((r) => r.photo_count === 0);
    expect(empty).toHaveLength(1);
    await signInViaApi(page);
    await page.goto("/reports");
    await page.getByRole("searchbox", { name: "Search" }).fill(empty[0].job_reference);
    await expect(page.getByTestId("reports-table").locator("tbody tr")).toHaveCount(1);
    await expect(page.getByTestId("reports-table").locator("tbody tr").getByRole("cell").nth(5)).toHaveText("0");
    await page.getByRole("link", { name: empty[0].job_reference }).click();
    await expect(page.getByText("No photos were submitted with this report.")).toBeVisible();
    await expect(page.getByTestId("photo-thumb")).toHaveCount(0);
    await expect(page.getByTestId("checklist")).toBeVisible();
  });

  test("the long-address report shows everything without breaking the layout at 360px", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const found = await api.get<Page_<ReportItem>>("reports", { q: "Kingsdown Conservation" });
    expect(found.total).toBe(1);
    const d = await detailFor(api, found.items[0]);
    expect(d.job.notes!.length).toBeGreaterThan(1000);
    expect(d.painter_notes!.length).toBeGreaterThan(700);

    await page.setViewportSize({ width: 360, height: 800 });
    await signInViaApi(page);
    await page.goto(`/reports/${found.items[0].id}`);
    const address = page.getByTestId("site-address");
    await expect(address).toContainText("Flat 14, The Old Chapel Apartments, 112-118 St Michael's Hill Road");
    await expect(address).toContainText("Kingsdown Conservation Area (rear entrance via Montague Place)");
    await expect(address).toContainText("BS2 8DT");
    await expect(page.getByTestId("job-details")).toContainText(d.job.notes!.slice(-60));
    await expect(page.getByTestId("painter-notes")).toContainText(d.painter_notes!.slice(-60));
    await expectNoHorizontalOverflow(page);
    // nothing sticks out of its card
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".panel dd, .panel p")].filter(
        (el) => el.scrollWidth > el.clientWidth + 1,
      ).length,
    );
    expect(clipped).toBe(0);
  });

  test("an unknown report id shows Report not found", async ({ page }) => {
    await signInViaApi(page);
    await page.goto(`/reports/${UNKNOWN_ID}`);
    await expect(page.getByRole("heading", { name: "Report not found" })).toBeVisible();
    await page.getByRole("link", { name: "Back to reports" }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expectMainHasText(page);
  });

  test("a malformed report id is also shown as not found", async ({ page }) => {
    await signInViaApi(page);
    await page.goto("/reports/not-a-uuid");
    await expect(page.getByRole("heading", { name: "Report not found" })).toBeVisible();
  });

  test("the back link keeps the list's filters", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const expected = await api.get<Page_<ReportItem>>("reports", { review_status: "reviewed", page: 2 });
    await signInViaApi(page);
    await page.goto("/reports?review_status=reviewed&page=2");
    await page.getByTestId("reports-table").getByRole("link").first().click();
    await page.getByTestId("back-link").click();
    await expect(page).toHaveURL(/\/reports\?review_status=reviewed&page=2$/);
    await expect(page.getByTestId("result-count")).toContainText(`of ${expected.total} reports`);
  });

  test("expired photo URLs: a failed image refetches the report once and the photos load", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const item = (await api.allReports()).find((r) => r.photo_count >= 3)!;
    await signInViaApi(page);
    let reportRequests = 0;
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === `/api/v1/manager/reports/${item.id}`) reportRequests += 1;
    });
    let photoFailures = 0;
    await page.route(/\/api\/v1\/photos\//, (route) => {
      if (photoFailures < item.photo_count) {
        photoFailures += 1;
        return route.fulfill({
          status: 403,
          contentType: "application/problem+json",
          body: JSON.stringify({ type: "about:blank", title: "Forbidden", status: 403, code: "invalid_signature", request_id: "e2e" }),
        });
      }
      return route.continue();
    });
    await page.goto(`/reports/${item.id}`);
    // every thumbnail failed once, the report was refetched, and the fresh URLs now load
    await expect.poll(() => reportRequests).toBe(2);
    await expect
      .poll(() =>
        page.locator(".photo-img").evaluateAll((els) => els.length > 0 && els.every((e) => e instanceof HTMLImageElement && e.complete && e.naturalWidth > 0)),
      )
      .toBe(true);
    await page.waitForTimeout(1000);
    expect(reportRequests, "no refetch loop").toBe(2);
  });
});
