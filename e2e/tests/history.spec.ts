import {
  MANAGER2,
  expect,
  test,
  ManagerApi,
  expectNoAxeViolations,
  londonDateTime,
  reseed,
  signInViaApi,
} from "./support";

// The history needs events, so these tests write; each starts from a fresh seed (see playwright.config.ts).
test.beforeEach(() => reseed());
test.afterAll(() => reseed());

test.describe("T-002f: History panel", () => {
  test("an untouched report says no changes are recorded", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const target = (await api.awaiting())[0];
    await signInViaApi(page);
    await page.goto(`/reports/${target.id}`);
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
    await expect(page.getByTestId("history-empty")).toHaveText("No changes recorded yet.");
    await expectNoAxeViolations(page, "report with empty history");
  });

  test("three events show newest first with London times, sentences and before/after, long values cut", async ({ page, request }) => {
    const sarah = await ManagerApi.create(request);
    const priya = await ManagerApi.create(request, MANAGER2);
    const target = (await sarah.awaiting())[0];
    const before = await sarah.get<{ painter_notes: string | null }>(`reports/${target.id}`);
    await sarah.review(target.id); // 1: reviewed (Sarah)
    const long = "Z".repeat(250);
    await priya.edit(target.id, { painter_notes: long }); // 2 and 3: edited, then reopened (Priya)

    const events = await sarah.history(target.id);
    expect(events.map((e) => e.action)).toEqual(["report.reopened", "report.edited", "report.reviewed"]);

    await signInViaApi(page);
    await page.goto(`/reports/${target.id}`);
    const rows = page.getByTestId("history-event");
    await expect(rows).toHaveCount(3);
    const reviewedAt = events[2].occurred_at;
    await expect(rows.nth(0).getByTestId("history-sentence")).toHaveText(
      `Report returned to Awaiting review (previously reviewed by Sarah Whitfield on ${londonDateTime(reviewedAt)})`,
    );
    await expect(rows.nth(1).getByTestId("history-sentence")).toHaveText("Priya Nair changed Operative notes");
    await expect(rows.nth(2).getByTestId("history-sentence")).toHaveText("Sarah Whitfield marked the report as reviewed");
    for (const [i, e] of events.entries()) await expect(rows.nth(i)).toContainText(londonDateTime(e.occurred_at));

    // the edit: old and new text, the long new value cut at 200 characters with a toggle
    const edit = rows.nth(1);
    await expect(edit.getByTestId("history-before")).toHaveText(
      (before.painter_notes ?? "").length > 200 ? `${before.painter_notes!.slice(0, 200)}…` : (before.painter_notes ?? "(empty)"),
    );
    await expect(edit.getByTestId("history-after")).toHaveText(`${"Z".repeat(200)}…`);
    const toggle = edit.getByRole("button", { name: "Show full change" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(edit.getByTestId("history-after")).toHaveText(long);
    await expect(edit.getByRole("button", { name: "Hide full change" })).toHaveAttribute("aria-expanded", "true");
    await expectNoAxeViolations(page, "report with history");
  });

  test("history failing leaves the rest of the page working; Try again recovers", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const target = (await api.awaiting())[0];
    await api.review(target.id);
    await signInViaApi(page);
    let fail = true;
    await page.route(/\/history$/, async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      if (!fail) return route.continue();
      return route.fulfill({
        status: 500,
        contentType: "application/problem+json",
        body: JSON.stringify({ type: "about:blank", title: "Internal Server Error", status: 500, code: "internal_error", request_id: "e2e" }),
      });
    });
    await page.goto(`/reports/${target.id}`);
    const history = page.getByTestId("history");
    await expect(history.getByTestId("loading-state")).toBeVisible();
    await expect(history.getByTestId("error-state")).toBeVisible();
    // the report itself is fine
    await expect(page.getByTestId("job-details")).toBeVisible();
    await expect(page.getByTestId("review-line")).toContainText("Reviewed by Sarah Whitfield");
    await expect(page.getByTestId("checklist")).toBeVisible();
    fail = false;
    await history.getByRole("button", { name: "Try again" }).click();
    await expect(history.getByTestId("history-event")).toHaveCount(1);
  });
});
