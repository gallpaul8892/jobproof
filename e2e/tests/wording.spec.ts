import type { Page } from "@playwright/test";
import { expect, test, ADMIN, MANAGER, ManagerApi, signInViaApi } from "./support";

// T-002l: no trade words in the chrome. Data (names, titles, notes) is excluded generically by removing every
// string value the page received from the API before scanning.
const TRADE = /painter|painters|decorat|painting/i;

function stringValues(json: unknown, out: Set<string>) {
  if (typeof json === "string") {
    // Enum-like lower-case tokens (role "painter") are not data shown to people, so they are not stripped.
    if (json.length >= 3 && !/^[a-z_]+$/.test(json)) out.add(json);
  } else if (Array.isArray(json)) json.forEach((v) => stringValues(v, out));
  else if (json && typeof json === "object") Object.values(json).forEach((v) => stringValues(v, out));
}

async function chromeOf(page: Page, seen: Set<string>): Promise<string> {
  const text = await page.evaluate(() => {
    const attrs = [...document.querySelectorAll("[title],[aria-label],[placeholder]")].flatMap((e) =>
      ["title", "aria-label", "placeholder"].map((a) => e.getAttribute(a) ?? ""),
    );
    return [document.body.innerText, document.title, ...attrs].join("\n");
  });
  let out = text;
  for (const v of [...seen].sort((a, b) => b.length - a.length)) out = out.split(v).join(" ");
  return out;
}

function collect(page: Page, seen: Set<string>) {
  page.on("response", async (res) => {
    if (!res.url().includes("/api/v1/") || !(res.headers()["content-type"] ?? "").includes("json")) return;
    try {
      stringValues(await res.json(), seen);
    } catch {
      /* body no longer available */
    }
  });
}

async function scan(page: Page, seen: Set<string>, ready: () => Promise<void>) {
  await ready();
  await page.waitForLoadState("networkidle");
  expect(await chromeOf(page, seen)).not.toMatch(TRADE);
}

test.describe("T-002l industry-neutral wording", () => {
  test("login, with demo accounts Manager, Operative and Admin", async ({ page }) => {
    const seen = new Set<string>();
    collect(page, seen);
    await page.goto("/login");
    await expect(page.getByTestId("demo-accounts")).toBeVisible();
    await expect(page.getByTestId("demo-account-manager").first()).toContainText("Manager");
    await expect(page.getByTestId("demo-account-painter").locator(".demo-role")).toHaveText("Operative");
    await expect(page.getByTestId("demo-account-admin").locator(".demo-role")).toHaveText("Admin");
    await scan(page, seen, async () => undefined);
  });

  test("manager pages: dashboard, reports, report detail (view and edit), billing", async ({ page, request }) => {
    const seen = new Set<string>();
    collect(page, seen);
    const api = await ManagerApi.create(request);
    const first = (await api.allReports())[0];
    await signInViaApi(page);

    await page.goto("/");
    await expect(page.getByTestId("review-queue")).toBeVisible();
    await scan(page, seen, async () => undefined);

    await page.goto("/reports");
    await expect(page.getByTestId("reports-table")).toBeVisible();
    await expect(page.getByLabel("Operative")).toBeVisible();
    await expect(page.getByRole("option", { name: "All operatives" })).toBeAttached();
    await scan(page, seen, async () => undefined);

    await page.goto(`/reports/${first.id}`);
    await expect(page.getByRole("heading", { name: "Operative", exact: true })).toBeVisible();
    await expect(page.getByText("Submitted by")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Operative notes" })).toBeVisible();
    await scan(page, seen, async () => undefined);

    await page.getByTestId("edit-report").click();
    await expect(page.getByLabel("Operative notes")).toBeVisible();
    await scan(page, seen, async () => undefined);

    await page.goto("/billing");
    await scan(page, seen, async () => {
      await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
    });
  });

  test("empty and error states", async ({ page }) => {
    const seen = new Set<string>();
    collect(page, seen);
    await signInViaApi(page);
    await page.route(/\/api\/v1\/manager\/reports(\?.*)?$/, (route) =>
      route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 20 } }),
    );
    await page.goto("/reports");
    await expect(page.getByText("Reports appear here when operatives submit them.")).toBeVisible();
    await scan(page, seen, async () => undefined);

    await page.unroute(/\/api\/v1\/manager\/reports(\?.*)?$/);
    await page.route(/\/api\/v1\/manager\/dashboard$/, (route) =>
      route.fulfill({ status: 500, json: { status: 500 } }),
    );
    await page.goto("/");
    await expect(page.getByRole("alert").first()).toBeVisible();
    await scan(page, seen, async () => undefined);
  });

  test("settings and not-authorised pages", async ({ page }) => {
    const seen = new Set<string>();
    collect(page, seen);
    await signInViaApi(page, ADMIN);
    await page.goto("/settings");
    await expect(page.getByTestId("settings-page")).toBeVisible();
    await scan(page, seen, async () => undefined);
    await page.goto("/reports");
    await expect(page.getByTestId("not-authorised")).toBeVisible();
    await scan(page, seen, async () => undefined);

    const manager = await page.context().newPage();
    collect(manager, seen);
    await signInViaApi(manager, MANAGER);
    await manager.goto("/settings");
    await expect(manager.getByTestId("not-authorised")).toBeVisible();
    await scan(manager, seen, async () => undefined);
  });

  test("a field worker sees the operative wording on the not-authorised page", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("demo-account-painter").getByRole("button", { name: "Use" }).click();
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByTestId("not-authorised")).toContainText("an operative");
    await expect(page.getByTestId("not-authorised")).toContainText("Operatives use the mobile app");
  });
});
