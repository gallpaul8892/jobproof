import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { mockApi, problem } from "../../test/mockApi";
import { PRIYA, customerRecord, summary } from "../../test/fixtures";
import { CustomerPage } from "../Customer";

function renderPage(handler: Parameters<typeof mockApi>[0], state?: unknown) {
  const calls = mockApi((req) => (req.path.endsWith("/auth/me") ? { body: { id: PRIYA.id, full_name: PRIYA.name, email: "p@x", role: "manager" } } : handler(req)));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createMemoryRouter([{ path: "/customers/:customerId", element: createElement(CustomerPage) }], {
    initialEntries: [{ pathname: "/customers/cust1", state }],
  });
  render(createElement(QueryClientProvider, { client }, createElement(RouterProvider, { router })));
  return { calls };
}

const ok = (path: string) => {
  if (path.endsWith("/history")) return { body: { items: [], total: 0 } };
  if (path.endsWith("/manager/reports")) return { body: { items: [summary(1, { review_status: "reviewed" } as never), summary(2)], total: 2, page: 1, page_size: 100 } };
  return { body: customerRecord() };
};

describe("Customer page", () => {
  it("shows the details, the customer's reports with a page size of 100 and the customer filter, and History", async () => {
    const { calls } = renderPage(({ path }) => ok(path));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Harbourside Lettings Ltd"));
    expect(screen.getByTestId("customer-email").textContent).toBe("marcus@harbourside.example.co.uk");
    expect(screen.getByTestId("customer-address").textContent).toContain("BS1 4SB");
    expect(screen.getByTestId("customer-last-changed").textContent).toBe("Not changed since it was created");
    await waitFor(() => expect(screen.getAllByTestId("customer-report-row")).toHaveLength(2));
    const listCall = calls.find((c) => c.path.endsWith("/manager/reports"))!;
    expect(new URLSearchParams(listCall.search).get("customer_id")).toBe("cust1");
    expect(new URLSearchParams(listCall.search).get("page_size")).toBe("100");
    expect(await screen.findByTestId("history-empty")).toBeTruthy();
    expect(screen.getByTestId("back-link").textContent).toContain("Reports");
  });

  it("returns to the report it was opened from", async () => {
    renderPage(({ path }) => ok(path), { from: "/reports/r1" });
    const back = await screen.findByTestId("back-link");
    expect(back.getAttribute("href")).toBe("/reports/r1");
  });

  it("Edit details opens the form with the impact notice; Cancel returns", async () => {
    renderPage(({ path }) => ok(path));
    await userEvent.click(await screen.findByTestId("edit-customer"));
    const form = await screen.findByTestId("edit-customer-form");
    expect(within(form).getByTestId("impact-notice").textContent).toContain("12 jobs, 12 reports (9 reviewed) and 7 issued invoices");
    expect(screen.queryByTestId("edit-customer")).toBeNull();
    await userEvent.click(screen.getByTestId("cancel-edit"));
    expect(await screen.findByTestId("edit-customer")).toBeTruthy();
  });

  it("saves, then shows Changes saved and the new value", async () => {
    let saved = false;
    renderPage(({ method, path }) => {
      if (method === "PATCH") {
        saved = true;
        return { body: customerRecord({ version: 3, phone: "0117 496 0123" }) };
      }
      if (path.endsWith("/history") || path.endsWith("/manager/reports")) return ok(path);
      return { body: customerRecord({ version: saved ? 3 : 2, phone: saved ? "0117 496 0123" : "07700 900201" }) };
    });
    await userEvent.click(await screen.findByTestId("edit-customer"));
    const phone = screen.getByLabelText("Phone");
    await userEvent.clear(phone);
    await userEvent.type(phone, "0117 496 0123");
    await userEvent.click(screen.getByTestId("save-changes"));
    expect((await screen.findByTestId("edit-saved")).textContent).toBe("Changes saved");
    expect(screen.getByTestId("customer-phone").textContent).toBe("0117 496 0123");
  });

  it("shows a not-found page for an unknown customer and an error with Try again otherwise", async () => {
    renderPage(() => problem(404, "not_found"));
    expect(await screen.findByTestId("not-found")).toBeTruthy();
  });

  it("an error loading the customer offers Try again", async () => {
    renderPage(() => problem(500, "internal_error"));
    expect(await screen.findByTestId("error-state", {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("renders a hostile name as text", async () => {
    renderPage(({ path }) => (path.endsWith("/history") || path.endsWith("/manager/reports") ? ok(path) : { body: customerRecord({ name: '<b>Smith</b> & "Sons"' }) }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe('<b>Smith</b> & "Sons"'));
    expect(document.querySelector("h1 b")).toBeNull();
  });

  it("opens straight in edit mode from a report's Edit customer details link", async () => {
    renderPage(({ path }) => ok(path), { from: "/reports/r1", edit: true });
    expect(await screen.findByTestId("edit-customer-form")).toBeTruthy();
  });
});
