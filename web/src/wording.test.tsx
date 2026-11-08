import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WORDING, roleLabel } from "@jobproof/shared";
import { BillingPage } from "./pages/Billing";
import { DashboardPage } from "./pages/Dashboard";
import { LoginPage } from "./pages/Login";
import { NotAuthorisedPage } from "./pages/NotAuthorised";
import { ReportDetailPage } from "./pages/ReportDetail";
import { ReportsPage } from "./pages/Reports";
import { SettingsPage } from "./pages/Settings";
import { dashboard, report, summary } from "./test/fixtures";
import { mockApi, renderWithDataRouter } from "./test/mockApi";

/** Trade words that must not appear in chrome. Fixtures below contain none, so any hit is chrome. */
const TRADE = /painter|painters|decorat|painting/i;

function chromeText(container: HTMLElement): string {
  const parts = [container.textContent ?? ""];
  for (const el of container.querySelectorAll("[title],[aria-label],[placeholder]")) {
    for (const a of ["title", "aria-label", "placeholder"]) {
      const v = el.getAttribute(a);
      if (v) parts.push(v);
    }
  }
  return parts.join("\n");
}

const operative = { id: "o1", name: "Dan Hughes" };
const addr = { line1: "1 High Street", town: "Leeds", postcode: "LS1 1AA" };
const neutralReport = (notes: string | null = "Two coats applied.") =>
  report({
    painter_notes: notes,
    job: {
      reference: "JP-1042",
      title: "Hall",
      job_type: "commercial_unit",
      status: "completed",
      scheduled_start: "2026-10-01",
      completed_on: "2026-10-10",
      site_address: addr,
      notes: null,
    },
    customer: {
      name: "Customer",
      customer_type: "business",
      contact_name: null,
      email: null,
      phone: null,
      billing_address: addr,
      job_count: 2,
    },
  } as never);

type Api = { status?: number; body?: unknown };
function api(over: (path: string) => Api | undefined = () => undefined, role = "manager") {
  mockApi(({ path }) => {
    const o = over(path);
    if (o) return o;
    if (path.endsWith("/auth/me"))
      return {
        body: { id: "u1", full_name: "Sam Lee", email: "s@x.test", role },
      };
    if (path.endsWith("/auth/demo-accounts"))
      return {
        body: ["manager", "painter", "admin"].map((r, i) => ({
          role: r,
          email: `user${i}@x.test`,
          password: "x",
          full_name: `User ${r.length}`,
        })),
      };
    if (path.endsWith("/manager/invoices")) return { body: { items: [], total: 0, page: 1, page_size: 20 } };
    if (path.endsWith("/admin/settings"))
      return {
        body: {
          company_name: "Acme",
          theme: { primary: "#112233", accent: "#445566" },
          updated_at: null,
          updated_by: null,
        },
      };
    if (path.endsWith("/manager/dashboard")) return { body: dashboard([summary(1, { painter: operative } as never)]) };
    if (path.endsWith("/manager/painters")) return { body: [operative] };
    if (path.endsWith("/manager/reports"))
      return {
        body: {
          items: [summary(1, { painter: operative } as never)],
          total: 1,
          page: 1,
          page_size: 20,
        },
      };
    if (path.endsWith("/history")) return { body: { items: [], total: 0 } };
    if (path.includes("/manager/reports/")) return { body: neutralReport() };
    return { body: {} };
  });
}

async function noTradeWords(ui: React.ReactElement, ready: () => unknown) {
  cleanup();
  const { container } = renderWithDataRouter(ui);
  await waitFor(ready);
  expect(chromeText(container)).not.toMatch(TRADE);
}

const failing =
  (status = 500) =>
  (path: string) =>
    path.includes("/manager/") || path.includes("/admin/")
      ? {
          status,
          body: {
            type: "about:blank",
            title: "x",
            status,
            code: "x",
            request_id: "t",
          },
        }
      : undefined;

describe("neutral wording", () => {
  afterEach(() => window.sessionStorage.clear());

  it("label module names the field worker once", () => {
    expect(WORDING.fieldWorker).toBe("Operative");
    expect(roleLabel("painter")).toBe("Operative");
    expect(roleLabel("manager")).toBe("Manager");
    expect(roleLabel("admin")).toBe("Admin");
  });

  it("login shows Manager, Operative, Admin demo accounts", async () => {
    api();
    await noTradeWords(<LoginPage />, () => screen.getByTestId("demo-account-painter"));
    expect(screen.getByText("Manager")).toBeTruthy();
    expect(screen.getByText("Admin")).toBeTruthy();
  });

  it("dashboard, with data, empty and error", async () => {
    api();
    await noTradeWords(<DashboardPage />, () => screen.getAllByText("Dan Hughes"));
    expect(screen.getAllByText("Operative").length).toBeGreaterThan(0);
  });

  it("dashboard empty and error", async () => {
    api((p) => (p.endsWith("/manager/dashboard") ? { body: dashboard([]) } : undefined));
    await noTradeWords(<DashboardPage />, () => screen.getByText(/Reports appear here when operatives submit them/));
    api(failing());
    await noTradeWords(<DashboardPage />, () => screen.getAllByRole("alert"));
  });

  it("reports list, with data, empty and error", async () => {
    api();
    await noTradeWords(<ReportsPage />, () => screen.getByText("Dan Hughes", { selector: "td" }));
    expect(screen.getByLabelText("Operative")).toBeTruthy();
    expect(screen.getByText("All operatives")).toBeTruthy();
    expect(screen.getByText(/submitted by operatives/)).toBeTruthy();

    api((p) =>
      p.endsWith("/manager/reports") ? { body: { items: [], total: 0, page: 1, page_size: 20 } } : undefined,
    );
    await noTradeWords(<ReportsPage />, () => screen.getByText(/Reports appear here when operatives submit them/));
    api(failing());
    await noTradeWords(<ReportsPage />, () => screen.getAllByRole("alert"));
  });

  it("report detail, view then edit, plus empty notes and error", async () => {
    const detail = (notes: string | null) => (p: string) =>
      p.endsWith("/manager/reports") || p.includes("/manager/reports/")
        ? p.endsWith("/history")
          ? { body: { items: [], total: 0 } }
          : { body: neutralReport(notes) }
        : undefined;
    api(detail("Two coats applied."));
    const { container } = renderWithDataRouter(<ReportDetailPage />);
    await waitFor(() => screen.getByText("Submitted by"));
    expect(screen.getByText("Operative notes")).toBeTruthy();
    expect(chromeText(container)).not.toMatch(TRADE);
    fireEvent.click(screen.getByTestId("edit-report"));
    await waitFor(() => screen.getByLabelText("Operative notes"));
    expect(chromeText(container)).not.toMatch(TRADE);

    cleanup();
    api(detail(null));
    await noTradeWords(<ReportDetailPage />, () => screen.getByText("The operative left no notes."));
    api(failing(404));
    await noTradeWords(<ReportDetailPage />, () => screen.getByTestId("not-found"));
    api(failing(500));
    await noTradeWords(<ReportDetailPage />, () => screen.getAllByRole("alert"));
  });

  it("billing and settings, including errors", async () => {
    api();
    await noTradeWords(<BillingPage />, () => screen.getByRole("heading", { level: 1 }));
    api(failing());
    await noTradeWords(<BillingPage />, () => screen.getAllByRole("alert"));
    api(undefined, "admin");
    await noTradeWords(<SettingsPage />, () => screen.getByRole("heading", { level: 1 }));
    api(failing());
    await noTradeWords(<SettingsPage />, () => screen.getAllByRole("alert"));
  });

  it.each(["painter", "manager", "admin"])("not-authorised page for %s", async (role) => {
    window.sessionStorage.setItem("jobproof.token", "t");
    api(undefined, role);
    await noTradeWords(<NotAuthorisedPage />, () => screen.getByTestId("not-authorised"));
    if (role === "painter") expect(screen.getByText(/an operative\. Managers review/)).toBeTruthy();
  });
});
