import {
  MANAGER,
  MANAGER2,
  expect,
  test,
  ManagerApi,
  expectNoAxeViolations,
  londonDateTime,
  londonTime,
  reseed,
  signInViaApi,
  type ReportFull,
} from "./support";


// These tests review reports, so each starts from a fresh seed (see playwright.config.ts).
test.beforeEach(() => reseed());
test.afterAll(() => reseed());

const reviewPosts = (page: import("@playwright/test").Page) => {
  const seen: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/review$/.test(new URL(r.url()).pathname)) seen.push(r.url());
  });
  return seen;
};

test.describe("T-002h: review a report", () => {
  test("Priya marks the oldest report reviewed: progress, reviewer line, badge, history", async ({ page, request }) => {
    const priya = await ManagerApi.create(request, MANAGER2);
    const target = (await priya.awaiting())[0];
    await signInViaApi(page, MANAGER2);
    // slow the request so the busy state can be seen
    await page.route(/\/review$/, async (route) => {
      await new Promise((r) => setTimeout(r, 500));
      await route.continue();
    });
    await page.goto(`/reports/${target.id}`);
    await expect(page.getByTestId("review-line")).toHaveText("Awaiting review");
    await expect(page.locator(".badges").getByText("Awaiting review")).toBeVisible();
    await expectNoAxeViolations(page, "report awaiting review");

    await page.getByRole("button", { name: "Mark as reviewed" }).click();
    const busy = page.getByRole("button", { name: "Marking as reviewed..." });
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveAttribute("aria-busy", "true");

    await expect(page.getByTestId("review-status")).toHaveText("Marked as reviewed");
    const done = await priya.get<ReportFull>(`reports/${target.id}`);
    expect(done.review_status).toBe("reviewed");
    expect(done.reviewed_by?.name).toBe(MANAGER2.name);
    await expect(page.getByTestId("review-line")).toHaveText(
      `Reviewed by Priya Nair on ${londonDateTime(done.reviewed_at!)}`,
    );
    await expect(page.getByTestId("review-status")).toHaveText("Marked as reviewed");
    await expect(page.locator(".badges").getByText("Reviewed", { exact: true })).toBeVisible();
    await expect(page.getByTestId("mark-reviewed")).toHaveCount(0);
    await expect(page.getByTestId("history-sentence").first()).toHaveText("Priya Nair marked the report as reviewed");
    await expectNoAxeViolations(page, "report reviewed");
  });

  test("a seeded reviewed report shows who reviewed it and has no button", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const all = await api.allReports();
    const item = all.find((r) => r.review_status === "reviewed")!;
    const d = await api.get<ReportFull>(`reports/${item.id}`);
    await signInViaApi(page);
    await page.goto(`/reports/${item.id}`);
    await expect(page.getByTestId("review-line")).toHaveText(
      `Reviewed by ${d.reviewed_by!.name} on ${londonDateTime(d.reviewed_at!)}`,
    );
    await expect(page.getByTestId("mark-reviewed")).toHaveCount(0);
  });

  test("the lists and the dashboard show the new state without a reload", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const awaiting = await api.awaiting();
    expect(awaiting.length).toBe(9);
    await signInViaApi(page);
    await page.goto("/");
    await expect(page.getByTestId("queue-row")).toHaveCount(5);
    await expect(page.getByTestId("stat-awaiting-review")).toContainText("9");
    const sixth = awaiting[5];

    await page.getByTestId("queue-review").first().click();
    await page.getByRole("button", { name: "Mark as reviewed" }).click();
    await expect(page.getByTestId("review-line")).toContainText("Reviewed by Sarah Whitfield");

    // client-side navigation only: the cache must have been invalidated
    await page.getByRole("navigation").getByRole("link", { name: "Dashboard" }).click();
    await expect(page.getByTestId("stat-awaiting-review")).toContainText("8");
    const refs = page.getByTestId("queue-ref");
    await expect(refs).toHaveCount(5);
    expect(await refs.allTextContents()).toEqual(awaiting.slice(1, 6).map((r) => r.job_reference));
    await expect(page.getByTestId("queue-row").getByText(awaiting[0].job_reference)).toHaveCount(0);
    await expect(refs.last()).toHaveText(sixth.job_reference);
    await expect(page.getByRole("link", { name: "View all 8 awaiting review" })).toBeVisible();

    await page.getByRole("navigation").getByRole("link", { name: "Reports" }).click();
    const row = page.getByTestId("report-row").filter({ hasText: awaiting[0].job_reference });
    await expect(row.locator("[data-status]").first()).toHaveAttribute("data-status", "reviewed");
  });

  test("when every report is reviewed the queue says so and offers no link", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    for (const r of await api.awaiting()) await api.review(r.id);
    await signInViaApi(page);
    await page.goto("/");
    await expect(page.getByText("Nothing is waiting for review.")).toBeVisible();
    await expect(page.getByTestId("review-queue-table")).toHaveCount(0);
    await expect(page.getByTestId("queue-view-all")).toHaveCount(0);
    await expect(page.getByTestId("stat-awaiting-review")).toContainText("0");
  });

  test("two managers: the second click names the first reviewer and the time", async ({ browser, request }) => {
    const sarahApi = await ManagerApi.create(request);
    const target = (await sarahApi.awaiting())[0];
    const sarah = await (await browser.newContext()).newPage();
    const priya = await (await browser.newContext()).newPage();
    await signInViaApi(sarah, MANAGER);
    await signInViaApi(priya, MANAGER2);
    await sarah.goto(`/reports/${target.id}`);
    await priya.goto(`/reports/${target.id}`);
    await expect(priya.getByTestId("mark-reviewed")).toBeVisible();

    await sarah.getByRole("button", { name: "Mark as reviewed" }).click();
    await expect(sarah.getByTestId("review-line")).toContainText("Reviewed by Sarah Whitfield");

    await priya.getByRole("button", { name: "Mark as reviewed" }).click();
    const d = await sarahApi.get<ReportFull>(`reports/${target.id}`);
    await expect(priya.getByTestId("review-status")).toHaveText(
      `Sarah Whitfield already reviewed this report at ${londonTime(d.reviewed_at!)}.`,
    );
    await expect(priya.getByTestId("review-line")).toHaveText(
      `Reviewed by Sarah Whitfield on ${londonDateTime(d.reviewed_at!)}`,
    );
    await expect(priya.getByTestId("mark-reviewed")).toHaveCount(0);
    // still one review on record
    expect(d.version).toBe(2);
    await sarah.context().close();
    await priya.context().close();
  });

  test("a report that changed while it was open must be reloaded before reviewing", async ({ browser, request }) => {
    const sarahApi = await ManagerApi.create(request);
    const target = (await sarahApi.awaiting())[0];
    const priyaCtx = await browser.newContext();
    const priya = await priyaCtx.newPage();
    await signInViaApi(priya, MANAGER2);
    await priya.goto(`/reports/${target.id}`);
    await expect(priya.getByTestId("mark-reviewed")).toBeVisible();

    await sarahApi.edit(target.id, { manager_notes: "Check the ceiling again." });

    await priya.getByRole("button", { name: "Mark as reviewed" }).click();
    const stale = priya.getByTestId("review-stale");
    await expect(stale).toContainText(
      "This report changed while you were looking at it. Reload to see the latest version before reviewing.",
    );
    await expect(priya.getByTestId("mark-reviewed")).toHaveCount(0);
    expect((await sarahApi.get<ReportFull>(`reports/${target.id}`)).review_status).toBe("awaiting_review");

    await priya.getByRole("button", { name: "Reload report" }).click();
    await expect(stale).toHaveCount(0);
    await expect(priya.getByTestId("manager-notes")).toHaveText("Check the ceiling again.");
    await priya.getByRole("button", { name: "Mark as reviewed" }).click();
    await expect(priya.getByTestId("review-line")).toContainText("Reviewed by Priya Nair");
    await priyaCtx.close();
  });

  test("a request that never arrives can be retried; one review on record", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const target = (await api.awaiting())[0];
    await signInViaApi(page);
    let first = true;
    await page.route(/\/review$/, (route) => {
      if (first) {
        first = false;
        return route.abort("failed");
      }
      return route.continue();
    });
    await page.goto(`/reports/${target.id}`);
    await page.getByRole("button", { name: "Mark as reviewed" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Could not mark as reviewed. Try again." })).toBeVisible();
    await page.getByRole("button", { name: "Mark as reviewed" }).click();
    await expect(page.getByTestId("review-line")).toContainText("Reviewed by Sarah Whitfield");
    await expect(page.getByTestId("review-error")).toHaveCount(0);
    const events = await api.history(target.id);
    expect(events.filter((e) => e.action === "report.reviewed")).toHaveLength(1);
  });

  test("a reply lost after the server saved the review is not reported as a failure", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const target = (await api.awaiting())[0];
    await signInViaApi(page);
    let first = true;
    await page.route(/\/review$/, async (route) => {
      if (first) {
        first = false;
        await route.fetch(); // the server processes it...
        return route.abort("failed"); // ...but the browser never sees the answer
      }
      return route.continue();
    });
    await page.goto(`/reports/${target.id}`);
    await page.getByRole("button", { name: "Mark as reviewed" }).click();
    await expect(page.getByTestId("review-error")).toBeVisible();
    await page.getByRole("button", { name: "Mark as reviewed" }).click();
    // the retry gets a conflict that shows our own review: treated as success, no "already reviewed" complaint
    await expect(page.getByTestId("review-line")).toContainText("Reviewed by Sarah Whitfield");
    await expect(page.getByTestId("review-status")).toHaveText("Marked as reviewed");
    await expect(page.getByTestId("review-error")).toHaveCount(0);
    const events = await api.history(target.id);
    expect(events.filter((e) => e.action === "report.reviewed")).toHaveLength(1);
  });

  test("a double click sends one request", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const target = (await api.awaiting())[0];
    await signInViaApi(page);
    const posts = reviewPosts(page);
    await page.route(/\/review$/, async (route) => {
      await new Promise((r) => setTimeout(r, 300));
      await route.continue();
    });
    await page.goto(`/reports/${target.id}`);
    await page.getByRole("button", { name: "Mark as reviewed" }).dblclick();
    await expect(page.getByTestId("review-line")).toContainText("Reviewed by");
    expect(posts).toHaveLength(1);
  });

  test("the button works from the keyboard", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const target = (await api.awaiting())[0];
    await signInViaApi(page);
    await page.goto(`/reports/${target.id}`);
    const button = page.getByRole("button", { name: "Mark as reviewed" });
    await button.focus();
    await expect(button).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("review-line")).toContainText("Reviewed by Sarah Whitfield");
  });
});
