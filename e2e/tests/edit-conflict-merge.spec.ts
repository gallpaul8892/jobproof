import type { APIRequestContext, Browser, Page } from "@playwright/test";
import {
  MANAGER,
  MANAGER2,
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

// These tests edit reports and customers, so each starts from a fresh seed (see playwright.config.ts).
test.beforeEach(() => reseed());
test.afterAll(() => reseed());

const save = (page: Page) => page.getByRole("button", { name: "Save changes" });
const painterNotes = (page: Page) => page.getByLabel("Operative notes");
const managerNotes = (page: Page) => page.getByLabel("Manager notes (internal)");
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const applyOnTop = (page: Page) => page.getByRole("button", { name: "Apply my changes on top" });

/** Two managers with the report open in edit mode at the same version. */
async function twoOnReport(browser: Browser, request: APIRequestContext) {
  const api = await ManagerApi.create(request);
  let report: ReportFull | undefined;
  for (const item of await api.awaiting()) {
    const r = await api.get<ReportFull>(`reports/${item.id}`);
    if (r.checklist.some((c) => !c.done)) {
      report = r;
      break;
    }
  }
  if (!report) throw new Error("no awaiting report with an open checklist item");
  const sarah = await (await browser.newContext()).newPage();
  const priya = await (await browser.newContext()).newPage();
  await signInViaApi(sarah, MANAGER);
  await signInViaApi(priya, MANAGER2);
  for (const p of [sarah, priya]) {
    await p.goto(`/reports/${report.id}`);
    await p.getByRole("button", { name: "Edit report" }).click();
  }
  return { api, report, sarah, priya };
}

test.describe("T-002o: Apply my changes on top (report)", () => {
  test("different fields merge without questions; nothing saves until Priya saves; history has both edits in order", async ({ browser, request }) => {
    const { api, report, sarah, priya } = await twoOnReport(browser, request);

    await painterNotes(sarah).fill("Sarah: second coat finished on the hall.");
    await save(sarah).click();
    await expect(sarah.getByTestId("edit-saved")).toHaveText("Changes saved");
    const afterSarah = await api.get<ReportFull>(`reports/${report.id}`);

    await managerNotes(priya).fill("Customer asked for invoice by email.");
    await save(priya).click();
    await expect(priya.getByTestId("edit-conflict")).toBeVisible();
    await expect(priya.getByRole("button", { name: "Reload latest" })).toBeVisible();

    // From here a route spy records any write Priya's browser sends.
    const writes: string[] = [];
    priya.on("request", (r) => {
      if (r.method() === "PATCH" || r.method() === "POST") writes.push(`${r.method()} ${r.url()}`);
    });
    await applyOnTop(priya).click();

    const notice = priya.getByTestId("merge-notice");
    await expect(notice).toHaveText(
      `Your changes were re-applied to the latest version (changed by Sarah Whitfield at ${londonTime(afterSarah.last_changed_at!)}). Check them and save.`,
    );
    await expect(notice).toBeFocused();
    await expect(painterNotes(priya)).toHaveValue("Sarah: second coat finished on the hall.");
    await expect(managerNotes(priya)).toHaveValue("Customer asked for invoice by email.");
    await expect(priya.getByTestId("reapplied-tag")).toHaveText("Re-applied");
    await expect(priya.getByTestId("edit-conflict")).toHaveCount(0);
    await expect(save(priya)).toBeEnabled();
    expect(writes).toEqual([]);
    expect((await api.get<ReportFull>(`reports/${report.id}`)).version).toBe(afterSarah.version);
    await expectNoAxeViolations(priya, "merged report form");

    await save(priya).click();
    await expect(priya.getByTestId("edit-saved")).toHaveText("Changes saved");
    const final = await api.get<ReportFull>(`reports/${report.id}`);
    expect(final.version).toBe(report.version + 2);
    expect(final.painter_notes).toBe("Sarah: second coat finished on the hall.");
    expect(final.manager_notes).toBe("Customer asked for invoice by email.");
    const edits = (await api.history(report.id)).filter((e) => e.action === "report.edited");
    expect(edits.map((e) => e.actor.name)).toEqual([MANAGER2.name, MANAGER.name]); // newest first
    await expect(priya.getByTestId("history-sentence").first()).toHaveText("Priya Nair changed Manager notes");
    await expect(priya.getByTestId("history-sentence").nth(1)).toHaveText("Sarah Whitfield changed Operative notes");
  });

  test("the same checklist note: Priya chooses per field, Save stays disabled until she does", async ({ browser, request }) => {
    const { api, report, sarah, priya } = await twoOnReport(browser, request);
    const item = report.checklist.find((c) => !c.done)!;
    const note = (p: Page) => p.getByLabel(`Note for ${item.label}`);

    await note(sarah).fill("Second coat 17 Oct");
    await save(sarah).click();
    await expect(sarah.getByTestId("edit-saved")).toHaveText("Changes saved");

    await note(priya).fill("Done 16 Oct");
    await managerNotes(priya).fill("Chase for sign-off.");
    await save(priya).click();
    await applyOnTop(priya).click();

    const group = priya.getByRole("group", { name: `Checklist: ${item.label} (note): changed by you and by Sarah Whitfield` });
    await expect(group).toBeVisible();
    await expect(group).toBeFocused();
    await expect(group).toContainText("Done 16 Oct");
    await expect(group).toContainText("Second coat 17 Oct");
    await expect(note(priya)).toHaveAttribute("readonly", "");
    await expect(managerNotes(priya)).toHaveValue("Chase for sign-off.");
    await expect(priya.getByTestId("reapplied-tag")).toHaveCount(1);
    await expect(save(priya)).toBeDisabled();
    await expect(priya.getByTestId("clash-hint")).toHaveText("Choose a version for each field marked as changed by both of you.");
    await expectNoAxeViolations(priya, "report clash view");

    // keyboard: tab into the radio group, choose Keep mine with the space bar
    await group.getByRole("radio", { name: "Keep mine" }).focus();
    await priya.keyboard.press("Space");
    await expect(group.getByRole("radio", { name: "Keep mine" })).toBeChecked();
    await expect(note(priya)).toHaveValue("Done 16 Oct");
    await expect(save(priya)).toBeEnabled();

    await save(priya).click();
    await expect(priya.getByTestId("edit-saved")).toHaveText("Changes saved");
    const final = await api.get<ReportFull>(`reports/${report.id}`);
    expect(final.checklist.find((c) => c.id === item.id)!.note).toBe("Done 16 Oct");
    expect(final.manager_notes).toBe("Chase for sign-off.");
  });

  test("Keep theirs on the only clash leaves nothing to save", async ({ browser, request }) => {
    const { sarah, priya } = await twoOnReport(browser, request);
    await managerNotes(sarah).fill("Sarah's manager note");
    await save(sarah).click();
    await expect(sarah.getByTestId("edit-saved")).toBeVisible();
    await managerNotes(priya).fill("Priya's manager note");
    await save(priya).click();
    await applyOnTop(priya).click();
    await priya.getByRole("radio", { name: "Keep theirs" }).check();
    await expect(priya.getByTestId("merge-nothing-left")).toHaveText(
      "Nothing left to save: the latest version already has the values you kept.",
    );
    await expect(save(priya)).toBeDisabled();
    await expect(managerNotes(priya)).toHaveValue("Sarah's manager note");
  });

  test("Sarah reviews after Priya loaded: applying on top shows the reopen warning; saving returns it to Awaiting review", async ({ browser, request }) => {
    const { api, report, priya } = await twoOnReport(browser, request);
    await api.review(report.id);

    await managerNotes(priya).fill("Needs a second look at the door.");
    await save(priya).click();
    await expect(priya.getByTestId("edit-conflict")).toBeVisible();
    await applyOnTop(priya).click();
    await expect(
      priya.getByRole("status").filter({ hasText: "This report has been reviewed. Saving changes will return it to Awaiting review." }),
    ).toBeVisible();
    await save(priya).click();
    await expect(priya.getByTestId("edit-saved")).toHaveText("Changes saved");
    const final = await api.get<ReportFull>(`reports/${report.id}`);
    expect(final.review_status).toBe("awaiting_review");
    expect(final.manager_notes).toBe("Needs a second look at the door.");
  });

  test("a second conflict while merging offers both buttons again", async ({ browser, request }) => {
    const { api, report, sarah, priya } = await twoOnReport(browser, request);
    await painterNotes(sarah).fill("Sarah v1");
    await save(sarah).click();
    await expect(sarah.getByTestId("edit-saved")).toBeVisible();
    await managerNotes(priya).fill("Priya's note");
    await save(priya).click();
    await applyOnTop(priya).click();
    await expect(priya.getByTestId("merge-notice")).toBeVisible();

    await api.edit(report.id, { painter_notes: "Sarah v2" }); // Sarah saves again before Priya does
    await save(priya).click();
    await expect(priya.getByTestId("edit-conflict")).toBeVisible();
    await expect(applyOnTop(priya)).toBeVisible();
    await expect(priya.getByRole("button", { name: "Reload latest" })).toBeVisible();
    await applyOnTop(priya).click();
    await expect(painterNotes(priya)).toHaveValue("Sarah v2");
    await expect(managerNotes(priya)).toHaveValue("Priya's note");
    await save(priya).click();
    await expect(priya.getByTestId("edit-saved")).toBeVisible();
    expect((await api.get<ReportFull>(`reports/${report.id}`)).version).toBe(report.version + 3);
  });

  test("if loading the latest version fails, Priya's text and the conflict view stay and Try again works", async ({ browser, request }) => {
    const { api, report, sarah, priya } = await twoOnReport(browser, request);
    await painterNotes(sarah).fill("Sarah's");
    await save(sarah).click();
    await expect(sarah.getByTestId("edit-saved")).toBeVisible();
    await managerNotes(priya).fill("Priya's note");
    await save(priya).click();
    await expect(priya.getByTestId("edit-conflict")).toBeVisible();

    const url = new RegExp(`/manager/reports/${report.id}$`);
    await priya.route(url, (route) => route.abort());
    await applyOnTop(priya).click();
    await expect(priya.getByTestId("apply-failed")).toContainText("Could not load the latest version.");
    await expect(managerNotes(priya)).toHaveValue("Priya's note");
    await expect(priya.getByTestId("edit-conflict")).toBeVisible();
    await expect(priya.getByTestId("merge-notice")).toHaveCount(0);

    await priya.unroute(url);
    await priya.getByTestId("apply-retry").click();
    await expect(priya.getByTestId("merge-notice")).toBeVisible();
    expect((await api.get<ReportFull>(`reports/${report.id}`)).manager_notes).toBeNull();
  });

  test("long clashing values scroll in their own box and nothing overflows at 360px", async ({ browser, request }) => {
    const { sarah, priya } = await twoOnReport(browser, request);
    const longA = ("Sarah wrote a very long note. ").repeat(40).slice(0, 1200);
    const longB = ("Priya wrote another long note! ").repeat(40).slice(0, 1200);
    await managerNotes(sarah).fill(longA);
    await save(sarah).click();
    await expect(sarah.getByTestId("edit-saved")).toBeVisible();
    await priya.setViewportSize({ width: 360, height: 800 });
    await managerNotes(priya).fill(longB);
    await save(priya).click();
    await applyOnTop(priya).click();
    const group = priya.getByRole("group", { name: "Manager notes: changed by you and by Sarah Whitfield" });
    await expect(group).toBeVisible();
    await expectNoHorizontalOverflow(priya);
    const box = group.getByRole("group", { name: "Your value" });
    expect(await box.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    expect(await box.evaluate((el) => el.clientHeight)).toBeLessThanOrEqual(12 * 16 + 4);
    await expectNoAxeViolations(priya, "long clash at 360px");
  });
});

test.describe("T-002o: Apply my changes on top (customer)", () => {
  async function twoOnCustomer(browser: Browser, request: APIRequestContext) {
    const api = await ManagerApi.create(request);
    const id = (await api.allReports()).find((r) => r.customer.name === "Harbourside Lettings Ltd")!.customer.id;
    const sarah = await (await browser.newContext()).newPage();
    const priya = await (await browser.newContext()).newPage();
    await signInViaApi(sarah, MANAGER);
    await signInViaApi(priya, MANAGER2);
    for (const p of [sarah, priya]) {
      await p.goto(`/customers/${id}`);
      await p.getByRole("button", { name: "Edit details" }).click();
    }
    return { api, id, sarah, priya };
  }

  test("Sarah's phone and Priya's email merge; an email clash needs a choice", async ({ browser, request }) => {
    const { api, id, sarah, priya } = await twoOnCustomer(browser, request);
    const before = await api.customer(id);

    await field(sarah, "Phone").fill("0117 496 0123");
    await save(sarah).click();
    await expect(sarah.getByTestId("edit-saved")).toBeVisible();

    await field(priya, "Email").fill("priya@harbourside.example.co.uk");
    await save(priya).click();
    await expect(priya.getByTestId("edit-conflict")).toBeVisible();
    await applyOnTop(priya).click();
    await expect(priya.getByTestId("merge-notice")).toContainText("changed by Sarah Whitfield at");
    await expect(field(priya, "Phone")).toHaveValue("0117 496 0123");
    await expect(field(priya, "Email")).toHaveValue("priya@harbourside.example.co.uk");
    await expect(save(priya)).toBeEnabled();
    await expectNoAxeViolations(priya, "merged customer form");
    expect((await api.customer(id)).version).toBe(before.version + 1); // nothing saved yet
    await save(priya).click();
    await expect(priya.getByTestId("edit-saved")).toBeVisible();
    const after = await api.customer(id);
    expect(after.version).toBe(before.version + 2);
    expect([after.phone, after.email]).toEqual(["0117 496 0123", "priya@harbourside.example.co.uk"]);

    // now both change the email
    await priya.getByRole("button", { name: "Edit details" }).click();
    await sarah.reload();
    await sarah.getByRole("button", { name: "Edit details" }).click();
    await field(sarah, "Email").fill("sarah@harbourside.example.co.uk");
    await save(sarah).click();
    await expect(sarah.getByTestId("edit-saved")).toBeVisible();
    await field(priya, "Email").fill("priya2@harbourside.example.co.uk");
    await save(priya).click();
    await applyOnTop(priya).click();
    const group = priya.getByRole("group", { name: "Email: changed by you and by Sarah Whitfield" });
    await expect(group).toBeVisible();
    await expect(field(priya, "Email")).toHaveAttribute("readonly", "");
    await expect(save(priya)).toBeDisabled();
    await expectNoAxeViolations(priya, "customer clash view");
    await group.getByRole("radio", { name: "Keep mine" }).check();
    await expect(field(priya, "Email")).toHaveValue("priya2@harbourside.example.co.uk");
    await save(priya).click();
    await expect(priya.getByTestId("edit-saved")).toBeVisible();
    expect((await api.customer(id)).email).toBe("priya2@harbourside.example.co.uk");
  });
});

test.describe("T-002n and T-002o together", () => {
  test("a customer edit appears in a report's History", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const all = await api.allReports();
    const first = all.find((r) => r.customer.name === "Harbourside Lettings Ltd")!;
    await api.editCustomer(first.customer.id, { phone: "0117 496 0123" });
    await signInViaApi(page, MANAGER2);
    await page.goto(`/reports/${first.id}`);
    await expect(page.getByTestId("history-sentence").first()).toHaveText("Sarah Whitfield changed customer details: Phone");
    await expect(page.getByTestId("history-customer-tag").first()).toHaveText("Customer");
  });
});

// Opt-in visual review: SCREENSHOT_DIR=/some/dir npx playwright test edit-conflict-merge -g screenshots
const dir = process.env.SCREENSHOT_DIR;
const sizes = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 360, height: 800 },
];
for (const size of sizes) {
  test(`screenshots of the conflict merge views at ${size.name} width`, async ({ browser, request }) => {
    test.skip(!dir, "set SCREENSHOT_DIR to capture screenshots");
    const api = await ManagerApi.create(request);
    const id = (await api.allReports()).find((r) => r.customer.name === "Harbourside Lettings Ltd")!.customer.id;
    const sarah = await (await browser.newContext()).newPage();
    const priya = await (await browser.newContext({ viewport: { width: size.width, height: size.height } })).newPage();
    await signInViaApi(sarah, MANAGER);
    await signInViaApi(priya, MANAGER2);
    for (const p of [sarah, priya]) {
      await p.goto(`/customers/${id}`);
      await p.getByRole("button", { name: "Edit details" }).click();
    }
    await field(sarah, "Phone").fill("0117 496 0123");
    await field(sarah, "Email").fill("sarah@harbourside.example.co.uk");
    await save(sarah).click();
    await expect(sarah.getByTestId("edit-saved")).toBeVisible();
    await field(priya, "Email").fill("priya@harbourside.example.co.uk");
    await field(priya, "Town or city").fill("Bath");
    await save(priya).click();
    await expect(priya.getByTestId("edit-conflict")).toBeVisible();
    await priya.screenshot({ path: `${dir}/customer-conflict-${size.name}.png`, fullPage: true });
    await applyOnTop(priya).click();
    await expect(priya.getByTestId("merge-notice")).toBeVisible();
    await priya.screenshot({ path: `${dir}/customer-merge-${size.name}.png`, fullPage: true });
    await priya.getByRole("radio", { name: "Keep mine" }).check();
    await priya.screenshot({ path: `${dir}/customer-merge-resolved-${size.name}.png`, fullPage: true });
  });
}
