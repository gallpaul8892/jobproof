import { expect, test, expectMainHasText, ManagerApi, signInViaApi, UNKNOWN_ID, type Page_, type ReportItem } from "./support";
import type { Page, Route } from "@playwright/test";

type Target = { name: string; path: string; api: RegExp; heading: string | RegExp; empty?: { body: unknown; text: string } };

const emptyPage = { items: [], total: 0, page: 1, page_size: 20 };

function problem(status: number) {
  return JSON.stringify({
    type: "https://jobproof.dev/problems/internal_error",
    title: "Internal Server Error",
    status,
    code: "internal_error",
    request_id: "e2e-500",
  });
}

const targets = (reportId: string): Target[] => [
  {
    name: "dashboard",
    path: "/",
    api: /\/api\/v1\/manager\/dashboard$/,
    heading: "Dashboard",
  },
  {
    name: "reports",
    path: "/reports",
    api: /\/api\/v1\/manager\/reports(\?|$)/,
    heading: "Reports",
    empty: { body: emptyPage, text: "No reports yet" },
  },
  {
    name: "report detail",
    path: `/reports/${reportId}`,
    api: new RegExp(`/api/v1/manager/reports/${reportId}$`),
    heading: /·/,
  },
  {
    name: "billing",
    path: "/billing",
    api: /\/api\/v1\/manager\/invoices(\?|$)/,
    heading: "Billing",
    empty: { body: emptyPage, text: "No invoices yet" },
  },
];

async function firstReportId(request: Parameters<typeof ManagerApi.create>[0]): Promise<string> {
  const api = await ManagerApi.create(request);
  const page = await api.get<Page_<ReportItem>>("reports");
  return page.items[0].id;
}

async function delay(route: Route, ms: number) {
  await new Promise((r) => setTimeout(r, ms));
  await route.continue().catch(() => undefined);
}

async function expectPageData(page: Page, t: Target) {
  if (t.name === "dashboard") await expect(page.getByTestId("stat-awaiting-review")).toBeVisible();
  else if (t.name === "reports") await expect(page.getByTestId("reports-table")).toBeVisible();
  else if (t.name === "billing") await expect(page.getByTestId("invoices-table")).toBeVisible();
  else await expect(page.getByTestId("job-details")).toBeVisible();
}

test.describe("9. Resilient states", () => {
  test("a slow response shows the loading state before the data", async ({ page, request }) => {
    const id = await firstReportId(request);
    await signInViaApi(page);
    for (const t of targets(id)) {
      await page.route(t.api, (route) => delay(route, 2000));
      await page.goto(t.path);
      await expect(page.getByTestId("loading-state")).toBeVisible();
      await expectMainHasText(page);
      await expectPageData(page, t);
      await expect(page.getByTestId("loading-state")).toHaveCount(0);
      await page.unroute(t.api);
    }
  });

  test("empty lists show their empty states", async ({ page, request }) => {
    const id = await firstReportId(request);
    await signInViaApi(page);
    for (const t of targets(id).filter((x) => x.empty)) {
      await page.route(t.api, (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(t.empty!.body) }),
      );
      await page.goto(t.path);
      await expect(page.getByTestId("empty-state")).toContainText(t.empty!.text);
      await expectMainHasText(page);
      await page.unroute(t.api);
    }
  });

  test("an empty recent-reports list on the dashboard says so", async ({ page }) => {
    await signInViaApi(page);
    await page.route(/\/api\/v1\/manager\/dashboard$/, async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as Record<string, unknown>;
      await route.fulfill({ response: res, json: { ...body, recent_reports: [] } });
    });
    await page.goto("/");
    await expect(page.getByTestId("empty-state")).toContainText("No reports yet");
    await expect(page.getByTestId("stat-awaiting-review")).toBeVisible();
  });

  for (const failure of ["500", "network"] as const) {
    test(`a ${failure} failure shows an error with Try again, which recovers`, async ({ page, request }) => {
      const id = await firstReportId(request);
      await signInViaApi(page);
      for (const t of targets(id)) {
        await page.route(t.api, (route) =>
          failure === "500"
            ? route.fulfill({ status: 500, contentType: "application/problem+json", body: problem(500) })
            : route.abort("failed"),
        );
        await page.goto(t.path);
        const error = page.getByTestId("error-state");
        await expect(error).toBeVisible();
        await expect(error).toContainText("Something went wrong loading");
        if (failure === "500") await expect(error).toContainText("Ref: e2e-500");
        else await expect(error).toContainText("Can't reach the server");
        await expectMainHasText(page);

        await page.unroute(t.api);
        await page.getByRole("button", { name: "Try again" }).click();
        await expectPageData(page, t);
        await expect(page.getByTestId("error-state")).toHaveCount(0);
      }
    });
  }

  test("a 404 report shows not-found rather than an error, and a failed filter list keeps the filters visible", async ({ page }) => {
    await signInViaApi(page);
    await page.goto(`/reports/${UNKNOWN_ID}`);
    await expect(page.getByTestId("not-found")).toBeVisible();

    await page.route(/\/api\/v1\/manager\/reports(\?|$)/, (route) =>
      route.fulfill({ status: 500, contentType: "application/problem+json", body: problem(500) }),
    );
    await page.goto("/reports?review_status=reviewed");
    await expect(page.getByTestId("error-state")).toBeVisible();
    await expect(page.getByLabel("Review status")).toHaveValue("reviewed");
  });

  test("the retry button is reachable by keyboard", async ({ page }) => {
    await signInViaApi(page);
    await page.route(/\/api\/v1\/manager\/dashboard$/, (route) => route.abort("failed"));
    await page.goto("/");
    await expect(page.getByTestId("retry-button")).toBeVisible();
    await page.getByTestId("retry-button").focus();
    await expect(page.getByTestId("retry-button")).toBeFocused();
  });
});
