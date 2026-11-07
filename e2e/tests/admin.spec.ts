import { expect, test, ADMIN, API_URL, DEFAULT_NAME, MANAGER, MANAGER2, PAINTER, ManagerApi, apiToken, signInViaApi } from "./support";

const HOME_RE = /localhost:8080\/settings$/;

test.describe("T-002b: Admin sees only Settings", () => {
  test("Tom signs in with the demo account and lands on Settings", async ({ page, request }) => {
    await page.goto("/login");
    await page.getByTestId("demo-account-admin").getByRole("button", { name: "Use" }).click();
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(HOME_RE);
    await expect(page.getByTestId("user-name")).toHaveText(ADMIN.name);
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();

    const me = await request.get(`${API_URL}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${await apiToken(request, ADMIN)}` },
    });
    expect(((await me.json()) as { role: string }).role).toBe("admin");
  });

  test("both managers are listed as demo accounts and can sign in", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("demo-account-manager")).toHaveCount(2);
    for (const who of [MANAGER, MANAGER2]) {
      await page.getByLabel("Email").fill(who.email);
      await page.getByLabel("Password").fill(who.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByTestId("user-name")).toHaveText(who.name);
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page).toHaveURL(/\/login$/);
    }
  });

  test("a deep link to a manager page lands an admin on Settings after sign-in", async ({ page }) => {
    await page.goto("/login?from=%2Freports");
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(HOME_RE);
  });

  test("Settings shows the company name and both colours, editable, with nothing saved yet", async ({ page }) => {
    await signInViaApi(page, ADMIN);
    await page.goto("/settings");
    await expect(page.getByTestId("settings-page")).toBeVisible();
    await expect(page.getByLabel("Company name")).toHaveValue(DEFAULT_NAME);
    await expect(page.getByTestId("colour-primary-input")).toHaveValue("#1F5130");
    await expect(page.getByTestId("colour-accent-input")).toHaveValue("#2F5D3A");
    await expect(page.getByTestId("preset-forest")).toBeChecked();
    await expect(page.getByTestId("company-name-save")).toBeDisabled();
    await expect(page.getByTestId("colour-save")).toBeDisabled();
    await expect(page.getByTestId("last-changed")).toBeVisible();
  });

  test("a failing settings request shows Try again, which recovers", async ({ page }) => {
    await signInViaApi(page, ADMIN);
    await page.route(/\/api\/v1\/admin\/settings$/, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/problem+json",
        body: JSON.stringify({ type: "about:blank", title: "Internal Server Error", status: 500, code: "internal_error", request_id: "e2e" }),
      }),
    );
    await page.goto("/settings");
    await expect(page.getByTestId("error-state")).toBeVisible();
    await page.unroute(/\/api\/v1\/admin\/settings$/);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("settings-page")).toBeVisible();
  });

  test("an admin on manager pages sees not-authorised and no manager request is made", async ({ page, request }) => {
    const reportId = (await (await ManagerApi.create(request)).allReports())[0]!.id;
    const forbidden: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/v1/manager/")) forbidden.push(r.url());
    });
    await signInViaApi(page, ADMIN);
    for (const path of ["/", "/reports", `/reports/${reportId}`, "/billing"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "This page is for managers" })).toBeVisible();
      await expect(page.getByText("an administrator")).toBeVisible();
      await expect(page.getByRole("link", { name: "Go to Settings" })).toHaveAttribute("href", "/settings");
      await expect(page.getByTestId("reports-table")).toHaveCount(0);
    }
    expect(forbidden).toEqual([]);
    await page.getByRole("link", { name: "Go to Settings" }).click();
    await expect(page).toHaveURL(HOME_RE);
  });

  test("a manager and a painter on /settings see not-authorised and no admin request is made", async ({ page }) => {
    const forbidden: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/v1/admin/")) forbidden.push(r.url());
    });

    await signInViaApi(page, MANAGER);
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "This page is for administrators" })).toBeVisible();
    await expect(page.getByTestId("settings-page")).toHaveCount(0);
    await page.getByRole("link", { name: "Go to the dashboard" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();

    await page.goto("/login");
    await page.getByLabel("Email").fill(PAINTER.email);
    await page.getByLabel("Password").fill(PAINTER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "This app is for head-office managers" })).toBeVisible();
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "This app is for head-office managers" })).toBeVisible();
    expect(forbidden).toEqual([]);
  });

  test("the header links match the role", async ({ page }) => {
    const links = () => page.getByRole("navigation", { name: "Main" }).getByRole("link").allTextContents();
    await signInViaApi(page, ADMIN);
    await page.goto("/settings");
    await expect(page.getByTestId("user-name")).toHaveText(ADMIN.name);
    expect(await links()).toEqual(["Settings"]);
    await page.getByRole("button", { name: "Sign out" }).click();

    await page.goto("/login");
    await page.getByLabel("Email").fill(MANAGER.email);
    await page.getByLabel("Password").fill(MANAGER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByTestId("user-name")).toHaveText(MANAGER.name);
    expect(await links()).toEqual(["Dashboard", "Reports", "Billing"]);
  });

  test("the API refuses an admin token on manager routes and a manager token on admin routes", async ({ request }) => {
    const admin = await apiToken(request, ADMIN);
    const manager = await apiToken(request, MANAGER);
    expect((await request.get(`${API_URL}/api/v1/manager/dashboard`, { headers: { Authorization: `Bearer ${admin}` } })).status()).toBe(403);
    expect((await request.get(`${API_URL}/api/v1/admin/settings`, { headers: { Authorization: `Bearer ${manager}` } })).status()).toBe(403);
  });
});
