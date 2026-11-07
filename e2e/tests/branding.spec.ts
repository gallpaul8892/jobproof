import { expect, test, DEFAULT_NAME, ManagerApi, signInViaApi, ADMIN } from "./support";

const SNAPSHOT_KEY = "jobproof.branding.v1";

test.describe("T-002c: the company name in the header, tab title and login", () => {
  test("a manager sees the name in the header and in every tab title", async ({ page, request }) => {
    const report = (await (await ManagerApi.create(request)).allReports())[0]!;
    await signInViaApi(page);
    await page.goto("/reports");
    await expect(page.getByTestId("reports-table")).toBeVisible();
    await expect(page.getByTestId("brand-name")).toHaveText(DEFAULT_NAME);
    await expect(page).toHaveTitle(`Reports | ${DEFAULT_NAME}`);
    await page.goto(`/reports/${report.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(report.job_reference);
    await expect(page).toHaveTitle(`Report ${report.job_reference} | ${DEFAULT_NAME}`);
    await page.goto("/billing");
    await expect(page).toHaveTitle(`Billing | ${DEFAULT_NAME}`);
    await page.goto("/");
    await expect(page).toHaveTitle(`Dashboard | ${DEFAULT_NAME}`);
  });

  test("the admin sees the name in the header and title of Settings", async ({ page }) => {
    await signInViaApi(page, ADMIN);
    await page.goto("/settings");
    await expect(page.getByTestId("brand-name")).toHaveText(DEFAULT_NAME);
    await expect(page).toHaveTitle(`Settings | ${DEFAULT_NAME}`);
  });

  test("first visit: brand and heading stay empty while branding loads, then show the name", async ({ page }) => {
    await page.route(/\/api\/v1\/branding$/, async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });
    await page.goto("/login");
    await expect(page.getByTestId("login-heading")).toBeEmpty();
    await expect(page).toHaveTitle("Sign in");
    expect(await page.locator("body").innerText()).not.toContain(DEFAULT_NAME);
    await expect(page.getByTestId("login-heading")).toHaveText(DEFAULT_NAME);
    await expect(page).toHaveTitle(`Sign in | ${DEFAULT_NAME}`);
  });

  test("a later visit paints the stored name at once, before branding answers", async ({ page }) => {
    await page.addInitScript(
      ([key, name]) => {
        localStorage.setItem(
          key!,
          JSON.stringify({
            company_name: name,
            theme: { primary: "#1F5130", accent: "#2F5D3A", background: "#FFFFFF", surface: "#F4F7F2", text: "#1B1F1C" },
          }),
        );
      },
      [SNAPSHOT_KEY, "Stored Name Ltd"],
    );
    await page.route(/\/api\/v1\/branding$/, async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.goto("/login");
    await expect(page.getByTestId("login-heading")).toHaveText("Stored Name Ltd", { timeout: 1000 });
    await expect(page).toHaveTitle("Sign in | Stored Name Ltd");
    // then the server's answer replaces and re-stores it
    await expect(page.getByTestId("login-heading")).toHaveText(DEFAULT_NAME);
    expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).company_name, SNAPSHOT_KEY)).toBe(DEFAULT_NAME);
  });

  test("a damaged snapshot is ignored", async ({ page }) => {
    await page.addInitScript((k) => localStorage.setItem(k, '{"company_name":"<img src=x>","theme":{"primary":"red"}}'), SNAPSHOT_KEY);
    await page.goto("/login");
    await expect(page.getByTestId("login-heading")).toHaveText(DEFAULT_NAME);
  });

  test("when branding fails the login says 'Sign in', works, and recovers later", async ({ page }) => {
    await page.route(/\/api\/v1\/branding$/, (route) => route.abort("connectionrefused"));
    await page.goto("/login");
    await expect(page.getByTestId("login-heading")).toHaveText("Sign in");
    await expect(page).toHaveTitle("Sign in");
    await page.getByLabel("Email").fill("manager@jobproof.test");
    await page.getByLabel("Password").fill("Manager123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    await expect(page).toHaveTitle("Dashboard");
    await page.unroute(/\/api\/v1\/branding$/);
    await page.reload();
    await expect(page.getByTestId("brand-name")).toHaveText(DEFAULT_NAME);
  });

  test("the product name appears nowhere in titles or visible text", async ({ page, request }) => {
    const report = (await (await ManagerApi.create(request)).allReports())[0]!;
    const check = async (label: string) => {
      expect(await page.title(), `${label} title`).not.toMatch(/jobproof/i);
      // the demo accounts list shows seeded e-mail addresses (...@jobproof.test), which are data
      const text = await page.evaluate(() => {
        const copy = document.body.cloneNode(true) as HTMLElement;
        copy.querySelector('[data-testid="demo-accounts"]')?.remove();
        return copy.textContent ?? "";
      });
      expect(text, `${label} body`).not.toMatch(/jobproof/i);
    };
    await page.goto("/login");
    await expect(page.getByTestId("login-heading")).toHaveText(DEFAULT_NAME);
    await check("login");
    await signInViaApi(page);
    for (const [path, ready] of [
      ["/", "stat-awaiting-review"],
      ["/reports", "reports-table"],
      [`/reports/${report.id}`, "photo-thumb"],
      ["/billing", "invoices-table"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByTestId(ready).first()).toBeVisible();
      await check(path);
    }
    await page.goto("/nothing-here");
    await check("not found");
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "This page is for administrators" })).toBeVisible();
    await check("not authorised");
  });

  test("the admin's Settings page has no product name either", async ({ page }) => {
    await signInViaApi(page, ADMIN);
    await page.goto("/settings");
    await expect(page.getByTestId("settings-page")).toBeVisible();
    expect(await page.title()).not.toMatch(/jobproof/i);
    expect(await page.locator("body").innerText()).not.toMatch(/jobproof/i);
  });
});
