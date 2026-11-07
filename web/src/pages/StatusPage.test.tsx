import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureApiClient } from "@jobproof/shared";
import { describe, expect, it } from "vitest";
import { StatusPage } from "./StatusPage";

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <StatusPage />
    </QueryClientProvider>,
  );
}

const ok = () =>
  new Response(JSON.stringify({ status: "ok", database: "ok", version: "0.1.0" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("StatusPage", () => {
  it("shows the brand and API: ok", async () => {
    configureApiClient({ baseUrl: "http://api.test", fetch: async () => ok() });
    renderPage();
    expect(screen.getByRole("heading", { name: "JobProof" })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("api-status").textContent).toBe("API: ok"));
  });

  it("shows an error state with Try again, which recovers", async () => {
    let up = false;
    configureApiClient({
      baseUrl: "http://api.test",
      fetch: async () => {
        if (!up) throw new TypeError("Failed to fetch");
        return ok();
      },
    });
    renderPage();
    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(screen.getByTestId("api-status").textContent).toBe("API: unavailable");
    up = true;
    await userEvent.click(retry);
    await waitFor(() => expect(screen.getByTestId("api-status").textContent).toBe("API: ok"));
  });

  it("treats a 503 as an error state", async () => {
    configureApiClient({
      baseUrl: "http://api.test",
      fetch: async () =>
        new Response(JSON.stringify({ status: "degraded", database: "unavailable", version: "0.1.0" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
    });
    renderPage();
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
