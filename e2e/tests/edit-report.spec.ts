import type { Page } from "@playwright/test";
import {
  MANAGER,
  MANAGER2,
  PAINTER,
  ADMIN,
  expect,
  test,
  ManagerApi,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  londonTime,
  reseed,
  signInViaApi,
  type ReportFull,
} from "./support";

// These tests edit reports, so each starts from a fresh seed (see playwright.config.ts).
test.beforeEach(() => reseed());
test.afterAll(() => reseed());

/** An awaiting-review report that has a checklist item not yet done. */
async function reportWithOpenItem(api: ManagerApi): Promise<{ report: ReportFull; open: ReportFull["checklist"][number] }> {
  for (const item of await api.awaiting()) {
    const report = await api.get<ReportFull>(`reports/${item.id}`);
    const open = report.checklist.find((c) => !c.done);
    if (open) return { report, open };
  }
  throw new Error("no awaiting report with an open checklist item");
}

const painterNotes = (page: Page) => page.getByLabel("Operative notes");
const managerNotes = (page: Page) => page.getByLabel("Manager notes (internal)");
const save = (page: Page) => page.getByRole("button", { name: "Save changes" });

test.describe("T-002j: edit a report", () => {
  test("Edit report shows the form; Cancel leaves, asks first when there are changes", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const { report } = await reportWithOpenItem(api);
    await signInViaApi(page);
    await page.goto(`/reports/${report.id}`);
    await expect(page.getByTestId("photo-thumb").first()).toBeVisible();
    const photosBefore = await page.getByTestId("photo-thumb").count();

    await page.getByRole("button", { name: "Edit report" }).click();
    await expect(page.getByTestId("edit-form")).toBeVisible();
    await expect(painterNotes(page)).toHaveValue(report.painter_notes ?? "");
    await expect(managerNotes(page)).toHaveValue("");
    await expect(page.getByTestId("edit-check-item")).toHaveCount(report.checklist.length);
    for (const c of report.checklist) {
      const item = page.getByTestId("edit-check-item").filter({ hasText: c.label });
      await expect(item.getByRole("checkbox", { name: `Done, ${c.label}` })).toBeChecked({ checked: c.done });
      await expect(item.getByLabel(`Note for ${c.label}`)).toHaveValue(c.note ?? "");
    }
    await expect(page.getByTestId("photo-thumb")).toHaveCount(photosBefore);
    await expect(save(page)).toBeDisabled();
    await expect(page.getByTestId("reopen-notice")).toHaveCount(0);
    await expectNoAxeViolations(page, "edit form");

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("edit-form")).toHaveCount(0);

    await page.getByRole("button", { name: "Edit report" }).click();
    await painterNotes(page).fill("Something new");
    await page.getByRole("button", { name: "Cancel" }).click();
    const dialog = page.getByRole("dialog", { name: "Discard your changes?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    await expect(painterNotes(page)).toHaveValue("Something new");
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("dialog", { name: "Discard your changes?" }).getByRole("button", { name: "Discard changes" }).click();
    await expect(page.getByTestId("edit-form")).toHaveCount(0);
    await expect(page.getByTestId("painter-notes")).not.toHaveText("Something new");
  });

  test("saving shows the new values and a history entry; a second edit uses the new version", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const { report, open } = await reportWithOpenItem(api);
    await signInViaApi(page);
    await page.goto(`/reports/${report.id}`);
    await page.getByRole("button", { name: "Edit report" }).click();

    await painterNotes(page).fill("Ceilings redone after the leak.");
    await page.getByRole("checkbox", { name: `Done, ${open.label}` }).check();
    await save(page).click();
    await expect(page.getByTestId("edit-saved")).toHaveText("Changes saved");
    await expect(page.getByTestId("edit-form")).toHaveCount(0);
    await expect(page.getByTestId("painter-notes")).toHaveText("Ceilings redone after the leak.");
    await expect(page.getByTestId("history-sentence").first()).toHaveText(
      `Sarah Whitfield changed Operative notes, Checklist: ${open.label}`,
    );
    const saved = await api.get<ReportFull>(`reports/${report.id}`);
    expect(saved.version).toBe(report.version + 1);
    expect(saved.checklist.find((c) => c.id === open.id)!.done).toBe(true);
    expect(saved.review_status).toBe("awaiting_review");

    // a second edit works from the new version
    await page.getByRole("button", { name: "Edit report" }).click();
    await managerNotes(page).fill("Chased the customer for sign-off.");
    await save(page).click();
    await expect(page.getByTestId("manager-notes")).toHaveText("Chased the customer for sign-off.");
    expect((await api.get<ReportFull>(`reports/${report.id}`)).version).toBe(report.version + 2);
    await expect(page.getByTestId("history-sentence").first()).toHaveText("Sarah Whitfield changed Manager notes");
    await expect(page.getByTestId("history-event")).toHaveCount(2);
  });

  test("editing a reviewed report warns first, then returns it to Awaiting review", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const target = (await api.awaiting())[0];
    await api.review(target.id);
    await signInViaApi(page, MANAGER2);
    await page.goto(`/reports/${target.id}`);
    await expect(page.getByTestId("review-line")).toContainText("Reviewed by Sarah Whitfield");

    await page.getByRole("button", { name: "Edit report" }).click();
    await expect(page.getByRole("status").filter({ hasText: "This report has been reviewed. Saving changes will return it to Awaiting review." })).toBeVisible();
    await managerNotes(page).fill("Needs a second coat on the door.");
    await save(page).click();

    await expect(page.getByTestId("edit-saved")).toHaveText("Changes saved");
    await expect(page.locator(".badges").getByText("Awaiting review")).toBeVisible();
    await expect(page.getByTestId("review-line")).toHaveText("Awaiting review");
    await expect(page.getByRole("button", { name: "Mark as reviewed" })).toBeEnabled();
    const sentences = await page.getByTestId("history-sentence").allTextContents();
    expect(sentences[0]).toMatch(/^Report returned to Awaiting review \(previously reviewed by Sarah Whitfield on /);
    expect(sentences[1]).toBe("Priya Nair changed Manager notes");
    expect(sentences[2]).toBe("Sarah Whitfield marked the report as reviewed");
  });

  test("two managers: the second save is refused, keeps her text and shows Sarah's saved value", async ({ browser, request }) => {
    const sarahApi = await ManagerApi.create(request);
    const { report } = await reportWithOpenItem(sarahApi);
    const sarahCtx = await browser.newContext();
    const priyaCtx = await browser.newContext();
    const sarah = await sarahCtx.newPage();
    const priya = await priyaCtx.newPage();
    await signInViaApi(sarah, MANAGER);
    await signInViaApi(priya, MANAGER2);
    await sarah.goto(`/reports/${report.id}`);
    await priya.goto(`/reports/${report.id}`);
    await sarah.getByRole("button", { name: "Edit report" }).click();
    await priya.getByRole("button", { name: "Edit report" }).click();

    await painterNotes(sarah).fill("Sarah's version of the notes.");
    await save(sarah).click();
    await expect(sarah.getByTestId("edit-saved")).toHaveText("Changes saved");
    const afterSarah = await sarahApi.get<ReportFull>(`reports/${report.id}`);

    await painterNotes(priya).fill("Priya's version of the notes.");
    await save(priya).click();
    const conflict = priya.getByTestId("edit-conflict");
    await expect(conflict).toContainText(
      `Sarah Whitfield changed this report at ${londonTime(afterSarah.last_changed_at!)}. Your changes were not saved.`,
    );
    await expect(painterNotes(priya)).toHaveValue("Priya's version of the notes.");
    await expect(priya.getByTestId("painter-notes-current")).toContainText("Current saved value:");
    await expect(priya.getByTestId("painter-notes-current")).toContainText("Sarah's version of the notes.");
    await expectNoAxeViolations(priya, "edit conflict");

    // nothing was overwritten
    const now = await sarahApi.get<ReportFull>(`reports/${report.id}`);
    expect(now.painter_notes).toBe("Sarah's version of the notes.");
    expect(now.version).toBe(afterSarah.version);

    // Reload latest asks first, then shows Sarah's text in the form
    await priya.getByRole("button", { name: "Reload latest" }).click();
    const dialog = priya.getByRole("dialog", { name: "Discard your edits and load the latest version?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    await expect(painterNotes(priya)).toHaveValue("Priya's version of the notes.");
    await priya.getByRole("button", { name: "Reload latest" }).click();
    await priya.getByRole("dialog").getByRole("button", { name: "Discard and reload" }).click();
    await expect(painterNotes(priya)).toHaveValue("Sarah's version of the notes.");
    await expect(priya.getByTestId("edit-conflict")).toHaveCount(0);
    // and her next save works
    await managerNotes(priya).fill("Agreed with Sarah.");
    await save(priya).click();
    await expect(priya.getByTestId("edit-saved")).toHaveText("Changes saved");
    expect((await sarahApi.get<ReportFull>(`reports/${report.id}`)).manager_notes).toBe("Agreed with Sarah.");
    await sarahCtx.close();
    await priyaCtx.close();
  });

  test("a save that never arrives: Try again works, one edit on record", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const { report } = await reportWithOpenItem(api);
    await signInViaApi(page);
    let first = true;
    await page.route(new RegExp(`/manager/reports/${report.id}$`), (route) => {
      if (route.request().method() === "PATCH" && first) {
        first = false;
        return route.abort("failed");
      }
      return route.continue();
    });
    await page.goto(`/reports/${report.id}`);
    await page.getByRole("button", { name: "Edit report" }).click();
    await painterNotes(page).fill("Typed once.");
    await save(page).click();
    await expect(page.getByTestId("edit-failure")).toBeVisible();
    await expect(painterNotes(page)).toHaveValue("Typed once.");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("edit-saved")).toHaveText("Changes saved");
    expect((await api.history(report.id)).filter((e) => e.action === "report.edited")).toHaveLength(1);
  });

  test("a reply lost after the server saved is treated as saved, with no duplicate entry", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const { report } = await reportWithOpenItem(api);
    await signInViaApi(page);
    let first = true;
    await page.route(new RegExp(`/manager/reports/${report.id}$`), async (route) => {
      if (route.request().method() === "PATCH" && first) {
        first = false;
        await route.fetch();
        return route.abort("failed");
      }
      return route.continue();
    });
    await page.goto(`/reports/${report.id}`);
    await page.getByRole("button", { name: "Edit report" }).click();
    await painterNotes(page).fill("Saved but unacknowledged.");
    await save(page).click();
    await expect(page.getByTestId("edit-failure")).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("edit-saved")).toHaveText("Changes saved");
    await expect(page.getByTestId("edit-conflict")).toHaveCount(0);
    await expect(page.getByTestId("painter-notes")).toHaveText("Saved but unacknowledged.");
    expect((await api.history(report.id)).filter((e) => e.action === "report.edited")).toHaveLength(1);
    expect((await api.get<ReportFull>(`reports/${report.id}`)).version).toBe(report.version + 1);
  });

  test("unsaved changes: in-page dialog on navigation and the browser prompt on reload", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const { report } = await reportWithOpenItem(api);
    await signInViaApi(page);
    await page.goto(`/reports/${report.id}`);
    await page.getByRole("button", { name: "Edit report" }).click();

    // clean form: leaving is free
    await page.getByRole("navigation").getByRole("link", { name: "Billing" }).click();
    await expect(page).toHaveURL(/\/billing$/);
    await page.goBack();
    await page.getByRole("button", { name: "Edit report" }).click();

    await painterNotes(page).fill("Unsaved words");
    await page.getByRole("navigation").getByRole("link", { name: "Reports" }).click();
    const dialog = page.getByRole("dialog", { name: "Leave without saving?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Stay" }).click();
    await expect(page).toHaveURL(new RegExp(`/reports/${report.id}$`));
    await expect(painterNotes(page)).toHaveValue("Unsaved words");

    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.type());
      void d.dismiss();
    });
    // closing the tab runs beforeunload; dismissing the prompt keeps the page, and the text, in place
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => dialogs).toContain("beforeunload");
    expect(page.isClosed()).toBe(false);
    await expect(painterNotes(page)).toHaveValue("Unsaved words");

    await page.getByRole("navigation").getByRole("link", { name: "Reports" }).click();
    await page.getByRole("dialog", { name: "Leave without saving?" }).getByRole("button", { name: "Leave" }).click();
    await expect(page).toHaveURL(/\/reports$/);
  });

  test("markup is shown literally; a long note fits a 360px screen", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const { report } = await reportWithOpenItem(api);
    const markup = '<b>bold</b> & "quotes"';
    await signInViaApi(page);
    await page.goto(`/reports/${report.id}`);
    await page.getByRole("button", { name: "Edit report" }).click();
    await managerNotes(page).fill(markup);
    await save(page).click();
    await expect(page.getByTestId("manager-notes")).toHaveText(markup);
    await expect(page.getByTestId("manager-notes").locator("b")).toHaveCount(0);
    await expect(page.getByTestId("history-after").first()).toHaveText(markup);

    const long = ("Unbroken" + "x".repeat(60) + " words ").repeat(18).slice(0, 1200);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.getByRole("button", { name: "Edit report" }).click();
    await painterNotes(page).fill(long);
    await expectNoHorizontalOverflow(page);
    await expect(page.getByTestId("painter-notes-count")).toHaveText("1,200 / 5,000");
    await save(page).click();
    await expect(page.getByTestId("painter-notes")).toContainText(long.slice(-40));
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page, "report detail 360px");
  });

  test("a note over the limit cannot be saved", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const { report } = await reportWithOpenItem(api);
    await signInViaApi(page);
    await page.goto(`/reports/${report.id}`);
    await page.getByRole("button", { name: "Edit report" }).click();
    await painterNotes(page).fill("x".repeat(5001));
    await expect(page.getByText("Use 5,000 characters or fewer.")).toBeVisible();
    await expect(painterNotes(page)).toHaveAttribute("aria-invalid", "true");
    await expect(save(page)).toBeDisabled();
    await painterNotes(page).fill("x".repeat(5000));
    await expect(save(page)).toBeEnabled();
  });

  test("admin and painter cannot reach the report or its edit control", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const { report } = await reportWithOpenItem(api);
    for (const who of [ADMIN, PAINTER]) {
      await signInViaApi(page, who);
      await page.goto(`/reports/${report.id}`);
      await expect(page.getByTestId("not-authorised")).toBeVisible();
      await expect(page.getByRole("button", { name: "Edit report" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Mark as reviewed" })).toHaveCount(0);
      await page.evaluate(() => sessionStorage.clear());
    }
  });
});
