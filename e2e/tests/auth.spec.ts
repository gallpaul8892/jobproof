import { expect, test, MANAGER, PAINTER, ManagerApi, TOKEN_KEY, signInViaApi, UNKNOWN_ID } from "./support";

test.describe("1. Sign in as manager", () => {
  test("demo account, sign in, reload and sign out", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);

    const demo = page.getByTestId("demo-account-manager").first();
    await expect(demo).toContainText(MANAGER.email);
    await demo.getByRole("button", { name: "Use" }).click();
    await expect(page.getByLabel("Email")).toHaveValue(MANAGER.email);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/localhost:8080\/$/);
    await expect(page.getByTestId("user-name")).toHaveText(MANAGER.name);
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("user-name")).toHaveText(MANAGER.name);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate((k) => sessionStorage.getItem(k), TOKEN_KEY)).toBeNull();
    await page.goto("/reports");
    await expect(page).toHaveURL(/\/login\?from=%2Freports$/);
  });

  test("a crafted from= value cannot redirect off-site or crash the app", async ({ page }) => {
    for (const from of ["/%09/example.com", "/%0A/example.com", "/%0D/example.com", "/%09%5Cexample.com", "//example.com", "/%5Cexample.com"]) {
      await page.goto(`/login?from=${from}`);
      await page.getByLabel("Email").fill(MANAGER.email);
      await page.getByLabel("Password").fill(MANAGER.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/localhost:8080\/$/);
      await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
      await expect(page.getByTestId("user-name")).toHaveText(MANAGER.name);
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page).toHaveURL(/\/login$/);
    }
  });

  test("a signed-in manager visiting /login is sent to the dashboard", async ({ page }) => {
    await signInViaApi(page);
    await page.goto("/login");
    await expect(page).toHaveURL(/localhost:8080\/$/);
  });
});

test.describe("2. Bad credentials are rejected", () => {
  test("shows the alert, keeps the email, clears the password", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(MANAGER.email);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("alert")).toHaveText("Email or password is incorrect.");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel("Email")).toHaveValue(MANAGER.email);
    await expect(page.getByLabel("Password")).toHaveValue("");
    await expect(page.getByLabel("Password")).toBeFocused();
  });

  test("unreachable API shows a network message", async ({ page }) => {
    await page.route(/\/api\/v1\/auth\/login$/, (route) => route.abort("connectionrefused"));
    await page.goto("/login");
    await page.getByLabel("Email").fill(MANAGER.email);
    await page.getByLabel("Password").fill(MANAGER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toHaveText(
      "Can't reach the server. Check it is running and try again.",
    );
  });

  test("demo accounts panel is hidden when the endpoint returns 404", async ({ page }) => {
    await page.route(/\/api\/v1\/auth\/demo-accounts$/, (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/problem+json",
        body: JSON.stringify({ type: "about:blank", title: "Not Found", status: 404, code: "not_found", request_id: "x" }),
      }),
    );
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.getByTestId("demo-accounts")).toHaveCount(0);
  });
});

test.describe("3. Manager pages are never shown to others", () => {
  test("a painter sees the not-authorised page and no manager request is made", async ({ page, request }) => {
    const api = await ManagerApi.create(request);
    const reportId = (await api.allReports())[0].id;

    const managerRequests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/v1/manager/")) managerRequests.push(r.url());
    });

    await page.goto("/login");
    await page.getByTestId("demo-account-painter").getByRole("button", { name: "Use" }).click();
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "This app is for head-office managers" })).toBeVisible();

    for (const path of ["/", "/reports", `/reports/${reportId}`, "/billing"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "This app is for head-office managers" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
      await expect(page.getByTestId("reports-table")).toHaveCount(0);
      await expect(page.getByTestId("invoices-table")).toHaveCount(0);
      await expect(page.getByTestId("stat-awaiting-review")).toHaveCount(0);
      await expect(page.getByTestId("user-name")).toHaveCount(0);
    }
    expect(managerRequests).toEqual([]);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("the API itself refuses a painter token on manager routes", async ({ request }) => {
    const login = await request.post("http://localhost:8000/api/v1/auth/login", {
      data: { email: PAINTER.email, password: PAINTER.password },
    });
    const { access_token } = (await login.json()) as { access_token: string };
    const res = await request.get("http://localhost:8000/api/v1/manager/dashboard", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(res.status()).toBe(403);
  });

  test("no token: /billing goes to login and returns to /billing after sign-in", async ({ page }) => {
    await page.goto("/billing");
    await expect(page).toHaveURL(/\/login\?from=%2Fbilling$/);
    await page.getByLabel("Email").fill(MANAGER.email);
    await page.getByLabel("Password").fill(MANAGER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/localhost:8080\/billing$/);
    await expect(page.getByRole("heading", { level: 1, name: "Billing" })).toBeVisible();
  });

  test("a 401 mid-session clears the token and shows the expiry notice", async ({ page }) => {
    await signInViaApi(page);
    await page.goto("/");
    await expect(page.getByTestId("user-name")).toHaveText(MANAGER.name);

    await page.route(/\/api\/v1\/manager\/reports(\?|$)/, (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/problem+json",
        headers: { "WWW-Authenticate": "Bearer" },
        body: JSON.stringify({
          type: "https://jobproof.dev/problems/unauthenticated",
          title: "Unauthorized",
          status: 401,
          code: "unauthenticated",
          request_id: "e2e-401",
        }),
      }),
    );
    await page.getByRole("link", { name: "Reports", exact: true }).click();

    await expect(page).toHaveURL(/\/login\?from=%2Freports&expired=1$/);
    await expect(page.getByText("Your session has expired. Please sign in again.")).toBeVisible();
    expect(await page.evaluate((k) => sessionStorage.getItem(k), TOKEN_KEY)).toBeNull();
  });

  test("unknown address shows page not found with a way home", async ({ page }) => {
    await page.goto(`/nothing/${UNKNOWN_ID}`);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await page.getByRole("link", { name: "Go to the dashboard" }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});
