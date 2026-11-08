import {
  expect,
  test,
  ADMIN,
  API_URL,
  DEFAULT_NAME,
  MANAGER,
  PAINTER,
  expectNoAxeViolations,
  expectNoContrastViolations,
  getBranding,
  ManagerApi,
  parseRgb,
  ratio,
  restoreDefaultSettings,
  signInViaApi,
} from "./support";

// Everything here changes the company settings. These tests run in their own project, after all
// others and one at a time, and every test puts the defaults back.
test.describe.configure({ mode: "serial" });
test.afterEach(async ({ request }) => {
  await restoreDefaultSettings(request);
});

const NAVY = "rgb(31, 58, 95)";
const NAVY_ACCENT = "rgb(43, 76, 126)";

test.describe("T-002c: Admin sets the company name", () => {
  test("saving shows 'Settings saved' and every page picks the new name up", async ({ page, context, request }) => {
    const report = (await (await ManagerApi.create(request)).allReports())[0]!;
    await signInViaApi(page, ADMIN);
    await page.goto("/settings");
    await page.getByLabel("Company name").fill("Arbour Tree Care Ltd");
    await expect(page.getByTestId("company-name-count")).toHaveText("20 / 60");
    await page.getByTestId("company-name-save").click();
    await expect(page.getByTestId("company-name-saved")).toHaveText("Settings saved");
    await expect(page.getByTestId("brand-name")).toHaveText("Arbour Tree Care Ltd");
    await expect(page).toHaveTitle("Settings | Arbour Tree Care Ltd");
    await expect(page.getByTestId("last-changed")).toContainText("Last changed by Tom Ashworth on");
    await expect(page.getByTestId("company-name-save")).toBeDisabled();
    expect((await getBranding(request)).company_name).toBe("Arbour Tree Care Ltd");

    // a manager, in a fresh tab and session, sees it on the login page, in the header and titles
    const manager = await context.newPage();
    await manager.goto("/login");
    await expect(manager.getByTestId("login-heading")).toHaveText("Arbour Tree Care Ltd");
    await signInViaApi(manager);
    await manager.goto("/reports");
    await expect(manager.getByTestId("brand-name")).toHaveText("Arbour Tree Care Ltd");
    await expect(manager).toHaveTitle("Reports | Arbour Tree Care Ltd");
    await manager.goto(`/reports/${report.id}`);
    await expect(manager).toHaveTitle(`Report ${report.job_reference} | Arbour Tree Care Ltd`);
  });

  test("bad names are explained beside the field and nothing is saved", async ({ page, request }) => {
    await signInViaApi(page, ADMIN);
    await page.goto("/settings");
    const input = page.getByLabel("Company name");
    const save = page.getByTestId("company-name-save");
    const error = page.getByTestId("company-name-error");

    await input.fill("");
    await expect(error).toHaveText("Enter a company name.");
    await expect(save).toBeDisabled();
    await input.fill("   ");
    await expect(error).toHaveText("Enter a company name.");
    await input.fill("x".repeat(61));
    await expect(error).toHaveText("Use 60 characters or fewer.");
    await expect(save).toBeDisabled();
    await input.fill("x".repeat(60));
    await expect(error).toHaveText("");
    await expect(save).toBeEnabled();
    expect((await getBranding(request)).company_name).toBe(DEFAULT_NAME);
  });

  test("a server-side rejection (control character) is shown beside the field", async ({ page, request }) => {
    await signInViaApi(page, ADMIN);
    await page.goto("/settings");
    // the client rule would stop this, so make the server see it by bypassing validation: U+200B
    // is accepted, a lone NUL is not, so send the request through the page with a tampered body
    await page.route(/\/api\/v1\/admin\/settings$/, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      await route.continue({ postData: JSON.stringify({ company_name: "Bad\u0000Name" }) });
    });
    await page.getByLabel("Company name").fill("Fine Name");
    await page.getByTestId("company-name-save").click();
    await expect(page.getByTestId("company-name-error")).toHaveText("Remove control characters.");
    expect((await getBranding(request)).company_name).toBe(DEFAULT_NAME);
  });

  test("markup in a name is shown as text everywhere and never runs", async ({ page }) => {
    const name = "<script>alert(1)</script> & Sons";
    let dialogs = 0;
    page.on("dialog", async (d) => {
      dialogs++;
      await d.dismiss();
    });
    await signInViaApi(page, ADMIN);
    await page.goto("/settings");
    await page.getByLabel("Company name").fill(name);
    await page.getByTestId("company-name-save").click();
    await expect(page.getByTestId("company-name-saved")).toBeVisible();
    await expect(page.getByTestId("brand-name")).toHaveText(name);
    await expect(page).toHaveTitle(`Settings | ${name}`);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByTestId("login-heading")).toHaveText(name);
    await expect(page).toHaveTitle(`Sign in | ${name}`);
    await page.reload(); // from the stored snapshot
    await expect(page.getByTestId("login-heading")).toHaveText(name);
    expect(dialogs).toBe(0);
  });

  test("a failed save keeps the typed value and Try again saves it", async ({ page, request }) => {
    await signInViaApi(page, ADMIN);
    await page.goto("/settings");
    await page.route(/\/api\/v1\/admin\/settings$/, (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({
            status: 500,
            contentType: "application/problem+json",
            body: JSON.stringify({ type: "about:blank", title: "Internal Server Error", status: 500, code: "internal_error", request_id: "e2e" }),
          })
        : route.continue(),
    );
    await page.getByLabel("Company name").fill("Retry Ltd");
    await page.getByTestId("company-name-save").click();
    await expect(page.getByTestId("company-name-failure")).toBeVisible();
    await expect(page.getByLabel("Company name")).toHaveValue("Retry Ltd");
    await page.unroute(/\/api\/v1\/admin\/settings$/);
    await page.getByTestId("company-name-failure").getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("company-name-saved")).toBeVisible();
    expect((await getBranding(request)).company_name).toBe("Retry Ltd");
  });

  test("managers and painters cannot change the name through the API", async ({ request }) => {
    for (const who of [MANAGER, PAINTER]) {
      const login = await request.post(`${API_URL}/api/v1/auth/login`, { data: { email: who.email, password: who.password } });
      const { access_token } = (await login.json()) as { access_token: string };
      const res = await request.patch(`${API_URL}/api/v1/admin/settings`, {
        headers: { Authorization: `Bearer ${access_token}` },
        data: { company_name: "Hijacked" },
      });
      expect(res.status()).toBe(403);
    }
    expect((await request.patch(`${API_URL}/api/v1/admin/settings`, { data: { company_name: "Hijacked" } })).status()).toBe(401);
    expect((await getBranding(request)).company_name).toBe(DEFAULT_NAME);
  });
});

test.describe("T-002e: Admin chooses the colour scheme", () => {
  test("picking Navy and saving re-themes the app for everyone", async ({ page, context, request }) => {
    await signInViaApi(page, ADMIN);
    await page.goto("/settings");
    await page.getByTestId("preset-navy").check();
    await expect(page.getByTestId("colour-primary-input")).toHaveValue("#1F3A5F");
    await expect(page.getByTestId("colour-accent-input")).toHaveValue("#2B4C7E");
    // the preview changes, the real header does not, until saved
    await expect(page.getByTestId("theme-preview").locator(".preview-header")).toHaveCSS("background-color", NAVY);
    await expect(page.locator(".topbar")).toHaveCSS("background-color", "rgb(31, 81, 48)");
    await page.getByTestId("colour-save").click();
    await expect(page.getByTestId("colour-saved")).toHaveText("Settings saved");
    await expect(page.locator(".topbar")).toHaveCSS("background-color", NAVY);

    const branding = await getBranding(request);
    expect(branding.theme.primary).toBe("#1F3A5F");
    expect(branding.theme.accent).toBe("#2B4C7E");

    // a manager (fresh tab and session)
    const manager = await context.newPage();
    await manager.goto("/login");
    await expect(manager.getByRole("button", { name: "Sign in" })).toHaveCSS("background-color", NAVY);
    await signInViaApi(manager);
    await manager.goto("/");
    await expect(manager.getByTestId("recent-report-row")).toHaveCount(5);
    await expect(manager.locator(".topbar")).toHaveCSS("background-color", NAVY);
    await expect(manager.getByTestId("recent-reports-table").getByRole("link").first()).toHaveCSS("color", NAVY_ACCENT);
  });

  test("a painter's not-authorised page is themed too", async ({ page }) => {
    await restoreThenNavy(page);
    await signInViaApi(page, PAINTER);
    await page.goto("/");
    await expect(page.getByTestId("not-authorised")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toHaveCSS("background-color", NAVY);
  });

  test("axe finds no contrast violations with Navy saved, and focus rings are navy", async ({ page, request }) => {
    const res = await request.patch(`${API_URL}/api/v1/admin/settings`, {
      headers: { Authorization: `Bearer ${await adminToken(request)}` },
      data: { theme: { primary: "#1F3A5F", accent: "#2B4C7E" } },
    });
    expect(res.ok()).toBe(true);
    const report = (await (await ManagerApi.create(request)).allReports()).find((r) => r.photo_count > 0)!;
    await page.goto("/login");
    await expect(page.getByTestId("login-heading")).not.toBeEmpty();
    await expectNoContrastViolations(page, "login (navy)");
    await page.getByLabel("Email").focus();
    await expect(page.getByLabel("Email")).toHaveCSS("outline-color", NAVY_ACCENT);

    await signInViaApi(page);
    for (const [path, ready] of [
      ["/", "recent-report-row"],
      ["/reports", "reports-table"],
      [`/reports/${report.id}`, "photo-thumb"],
      ["/billing", "invoices-table"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByTestId(ready).first()).toBeVisible();
      await expectNoContrastViolations(page, `${path} (navy)`);
    }
  });

  test("axe finds no contrast violations with the lowest-contrast accent the server accepts", async ({ page, context, request }) => {
    // #717171: 4.88:1 on white, 4.52:1 on the surface colour. The accent colours links, demo role
    // labels on the sign-in page, hovered table rows and the selected preset card.
    const res = await request.patch(`${API_URL}/api/v1/admin/settings`, {
      headers: { Authorization: `Bearer ${await adminToken(request)}` },
      data: { theme: { primary: "#717171", accent: "#717171" } },
    });
    expect(res.ok()).toBe(true);
    const report = (await (await ManagerApi.create(request)).allReports()).find((r) => r.photo_count > 0)!;
    await page.goto("/login");
    await expect(page.getByTestId("demo-accounts")).toBeVisible();
    await expectNoContrastViolations(page, "login (lowest accent)");

    await signInViaApi(page);
    for (const [path, ready] of [
      ["/", "recent-report-row"],
      ["/reports", "reports-table"],
      [`/reports/${report.id}`, "photo-thumb"],
      ["/billing", "invoices-table"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByTestId(ready).first()).toBeVisible();
      await page.getByTestId(ready).first().hover(); // hovered rows put the accent on the surface colour
      await expectNoContrastViolations(page, `${path} (lowest accent)`);
    }

    const admin = await context.newPage();
    await signInViaApi(admin, ADMIN);
    await admin.goto("/settings");
    await expect(admin.getByTestId("colour-accent-input")).toHaveValue("#717171");
    await expectNoContrastViolations(admin, "settings (lowest accent)");
  });

  test("every preset passes axe on the Settings page", async ({ page }) => {
    await signInViaApi(page, ADMIN);
    await page.goto("/settings");
    for (const id of ["charcoal", "burgundy", "navy", "forest"]) {
      await page.getByTestId(`preset-${id}`).check();
      await expect(page.getByTestId(`preset-${id}`)).toBeChecked();
      await expectNoContrastViolations(page, `settings preview ${id}`);
    }
  });

  test("a failing colour shows its ratio, blocks Save, and the preview keeps the last valid colours", async ({ page, request }) => {
    await signInViaApi(page, ADMIN);
    await page.goto("/settings");
    const requests: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "PATCH") requests.push(r.url());
    });
    await page.getByTestId("preset-navy").check();
    const primary = page.getByTestId("colour-primary-input");
    await primary.fill("#FFD400");
    await expect(page.getByTestId("colour-primary-ratio")).toHaveText("1.32:1 against the surface colour, needs 4.5:1");
    await expect(primary).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByTestId("colour-save")).toBeDisabled();
    await expect(page.getByTestId("theme-preview").locator(".preview-header")).toHaveCSS("background-color", NAVY);
    await primary.fill("#4CAF50");
    await expect(page.getByTestId("colour-primary-ratio")).toHaveText("2.57:1 against the surface colour, needs 4.5:1");
    await primary.fill("#777777");
    await expect(page.getByTestId("colour-primary-ratio")).toHaveText("4.14:1 against the surface colour, needs 4.5:1");
    await primary.fill("#767676"); // 4.54:1 on white but 4.20:1 on the surface colour
    await expect(page.getByTestId("colour-primary-ratio")).toHaveText("4.20:1 against the surface colour, needs 4.5:1");
    await expect(page.getByTestId("colour-save")).toBeDisabled();
    await primary.fill("#717171");
    await expect(page.getByTestId("colour-primary-ratio")).toHaveText("4.52:1 against the surface colour, passes");
    await expect(page.getByTestId("colour-save")).toBeEnabled();
    await primary.fill("#12");
    await expect(page.getByTestId("colour-primary-ratio")).toHaveText("Use a colour in the form #RRGGBB.");
    expect(requests).toEqual([]); // typing never sends anything
    expect((await getBranding(request)).theme.primary).toBe("#1F5130");
  });

  test("Reset to default asks first, fills the default, and saving restores it", async ({ page, request }) => {
    await signInViaApi(page, ADMIN);
    await page.goto("/settings");
    await page.getByTestId("preset-burgundy").check();
    await page.getByTestId("colour-save").click();
    await expect(page.getByTestId("colour-saved")).toBeVisible();
    expect((await getBranding(request)).theme.primary).toBe("#7A1F2B");

    await page.getByTestId("colour-reset").click();
    await expect(page.getByTestId("reset-dialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reset colours to the default green?" })).toBeVisible();
    await page.getByTestId("reset-cancel").click();
    await expect(page.getByTestId("colour-primary-input")).toHaveValue("#7A1F2B");

    await page.getByTestId("colour-reset").click();
    await page.getByTestId("reset-confirm").click();
    await expect(page.getByTestId("colour-primary-input")).toHaveValue("#1F5130");
    await expect(page.getByTestId("preset-forest")).toBeChecked();
    expect((await getBranding(request)).theme.primary).toBe("#7A1F2B"); // nothing saved yet
    await page.getByTestId("colour-save").click();
    await expect(page.getByTestId("colour-saved")).toBeVisible();
    expect((await getBranding(request)).theme.primary).toBe("#1F5130");
    await expect(page.locator(".topbar")).toHaveCSS("background-color", "rgb(31, 81, 48)");
  });

  test("the name and the colours save independently", async ({ page, request }) => {
    await signInViaApi(page, ADMIN);
    await page.goto("/settings");
    await page.getByTestId("preset-charcoal").check();
    await page.getByTestId("colour-save").click();
    await expect(page.getByTestId("colour-saved")).toBeVisible();
    let b = await getBranding(request);
    expect([b.company_name, b.theme.primary]).toEqual([DEFAULT_NAME, "#2B2B2B"]);
    await page.getByLabel("Company name").fill("Only Name Ltd");
    await page.getByTestId("company-name-save").click();
    await expect(page.getByTestId("company-name-saved")).toBeVisible();
    b = await getBranding(request);
    expect([b.company_name, b.theme.primary]).toEqual(["Only Name Ltd", "#2B2B2B"]);
  });

  test("the server's contrast rule is shown if the client is bypassed", async ({ page, request }) => {
    await signInViaApi(page, ADMIN);
    await page.goto("/settings");
    await page.route(/\/api\/v1\/admin\/settings$/, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      await route.continue({ postData: JSON.stringify({ theme: { primary: "#4CAF50", accent: "#2F5D3A" } }) });
    });
    await page.getByTestId("preset-navy").check();
    await page.getByTestId("colour-save").click();
    await expect(page.getByTestId("colour-primary-ratio")).toHaveText("Contrast 2.57:1 against the surface colour is below the required 4.5:1.");
    expect((await getBranding(request)).theme.primary).toBe("#1F5130");
    // the colour of the real UI is unchanged
    await expect(page.locator(".topbar")).toHaveCSS("background-color", "rgb(31, 81, 48)");
    const outline = parseRgb(await page.getByTestId("colour-primary-ratio").evaluate((e) => getComputedStyle(e).color));
    expect(ratio(outline, [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
  });
});

test.describe("T-002p: UK customers only", () => {
  test("the admin turns it off and on; managers' customer forms follow; the setting is restored", async ({ page, context, request }) => {
    const report = (await (await ManagerApi.create(request)).allReports())[0]!;
    await signInViaApi(page, ADMIN);
    await page.goto("/settings");
    const sw = page.getByRole("switch", { name: "UK customers only" });
    const save = page.getByTestId("uk-only-save");
    await expect(sw).toBeChecked();
    await expect(page.getByTestId("uk-only-help")).toHaveText(
      "Customer postcodes and phone numbers must be UK ones. Turn off to allow other countries.",
    );
    await expect(save).toBeDisabled();
    await expectNoAxeViolations(page, "settings with the UK-only switch");

    await sw.focus();
    await page.keyboard.press("Space");
    await expect(sw).not.toBeChecked();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByTestId("uk-only-saved")).toHaveText("Settings saved");
    await expect(save).toBeDisabled();
    expect((await getBranding(request)).uk_only_contact_details).toBe(false);
    await page.reload();
    await expect(page.getByRole("switch", { name: "UK customers only" })).not.toBeChecked();

    // a manager's customer form now accepts a foreign postcode and number (nothing is saved here)
    const manager = await context.newPage();
    await signInViaApi(manager);
    await manager.goto(`/customers/${report.customer.id}`);
    await manager.getByRole("button", { name: "Edit details" }).click();
    await manager.getByLabel("Postcode", { exact: true }).fill("10115");
    await manager.getByLabel("Phone", { exact: true }).fill("+1 202 555 0123");
    await expect(manager.getByTestId("postcode-error")).toHaveText("");
    await expect(manager.getByTestId("phone-error")).toHaveText("");
    await expect(manager.getByTestId("save-changes")).toBeEnabled();
    await manager.close();

    // turn it back on through the UI
    await page.getByRole("switch", { name: "UK customers only" }).check();
    await page.getByTestId("uk-only-save").click();
    await expect(page.getByTestId("uk-only-saved")).toHaveText("Settings saved");
    expect((await getBranding(request)).uk_only_contact_details).toBe(true);
  });
});

async function adminToken(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const login = await request.post(`${API_URL}/api/v1/auth/login`, { data: { email: ADMIN.email, password: ADMIN.password } });
  return ((await login.json()) as { access_token: string }).access_token;
}

async function restoreThenNavy(page: import("@playwright/test").Page): Promise<void> {
  const token = await adminToken(page.request);
  const res = await page.request.patch(`${API_URL}/api/v1/admin/settings`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { theme: { primary: "#1F3A5F", accent: "#2B4C7E" } },
  });
  expect(res.ok()).toBe(true);
}
