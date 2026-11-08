import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { useReport } from "@jobproof/shared";
import { describe, expect, it } from "vitest";
import { mockApi, problem } from "../../test/mockApi";
import { PRIYA, SARAH, report } from "../../test/fixtures";
import { ReviewPanel } from "./ReviewPanel";

/** The page owns the report query; refetching needs an active observer, as on the real page. */
function Page({ r, editing }: { r: ReturnType<typeof report>; editing: boolean }) {
  useReport(r.id);
  return <ReviewPanel report={r} editing={editing} />;
}

function setup(r = report(), editing = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(["me"], { id: PRIYA.id, full_name: PRIYA.name, role: "manager" });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Page r={r} editing={editing} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const reviewedBy = (who: typeof SARAH, at = "2026-10-15T09:40:00Z") =>
  report({ review_status: "reviewed", reviewed_by: who, reviewed_at: at, version: 2 });

describe("ReviewPanel", () => {
  it("shows the reviewer line and no button for a reviewed report", () => {
    mockApi(() => ({ body: {} }));
    setup(reviewedBy(SARAH, "2026-10-12T08:15:00Z"));
    expect(screen.getByTestId("review-line").textContent).toBe("Reviewed by Sarah Whitfield on 12 Oct 2026, 09:15");
    expect(screen.queryByTestId("mark-reviewed")).toBeNull();
  });

  it("sends one request on a double click, shows progress, then announces success", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const calls = mockApi(async () => {
      await gate;
      return { body: reviewedBy(PRIYA) };
    });
    setup();
    const button = screen.getByRole("button", { name: "Mark as reviewed" });
    await userEvent.dblClick(button);
    const busy = await screen.findByRole("button", { name: "Marking as reviewed..." });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    release();
    await waitFor(() => expect(screen.getByTestId("review-status").textContent).toBe("Marked as reviewed"));
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ path: "/api/v1/manager/reports/r1/review", body: { version: 1 } });
  });

  it("is focusable by keyboard and activates with Enter", async () => {
    const calls = mockApi(() => ({ body: reviewedBy(PRIYA) }));
    setup();
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByTestId("mark-reviewed"));
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
  });

  it("names the other manager and refetches when they reviewed first", async () => {
    const calls = mockApi(({ method }) =>
      method === "POST"
        ? problem(409, "already_reviewed", {
            current_version: 2,
            reviewed_by: SARAH,
            reviewed_at: "2026-10-15T10:40:00Z",
          })
        : { body: reviewedBy(SARAH) },
    );
    setup();
    await userEvent.click(screen.getByTestId("mark-reviewed"));
    await waitFor(() =>
      expect(screen.getByTestId("review-status").textContent).toBe("Sarah Whitfield already reviewed this report at 11:40."),
    );
    await waitFor(() => expect(calls.some((c) => c.method === "GET" && c.path.endsWith("/reports/r1"))).toBe(true));
  });

  it("treats a 409 for the signed-in user's own review as success", async () => {
    mockApi(({ method }) =>
      method === "POST"
        ? problem(409, "version_conflict", {
            current_version: 2,
            review_status: "reviewed",
            reviewed_by: PRIYA,
            reviewed_at: "2026-10-15T10:40:00Z",
            last_changed_by: PRIYA,
            last_changed_at: "2026-10-15T10:40:00Z",
          })
        : { body: reviewedBy(PRIYA) },
    );
    setup();
    await userEvent.click(screen.getByTestId("mark-reviewed"));
    await waitFor(() => expect(screen.getByTestId("review-status").textContent).toBe("Marked as reviewed"));
    expect(screen.queryByTestId("review-error")).toBeNull();
  });

  it("a stale version hides the button and offers Reload report", async () => {
    const calls = mockApi(({ method }) =>
      method === "POST"
        ? problem(409, "version_conflict", {
            current_version: 3,
            review_status: "awaiting_review",
            reviewed_by: null,
            reviewed_at: null,
            last_changed_by: SARAH,
            last_changed_at: "2026-10-15T10:40:00Z",
          })
        : { body: report({ version: 3 }) },
    );
    setup();
    await userEvent.click(screen.getByTestId("mark-reviewed"));
    const stale = await screen.findByTestId("review-stale");
    expect(stale.textContent).toContain("This report changed while you were looking at it. Reload to see the latest version before reviewing.");
    expect(screen.queryByTestId("mark-reviewed")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Reload report" }));
    await waitFor(() => expect(screen.queryByTestId("review-stale")).toBeNull());
    expect(calls.some((c) => c.method === "GET")).toBe(true);
  });

  it("after a 500 shows an alert, re-enables the button and retries with the same version", async () => {
    let fail = true;
    const calls = mockApi(() => (fail ? problem(500, "internal_error") : { body: reviewedBy(PRIYA) }));
    setup();
    await userEvent.click(screen.getByTestId("mark-reviewed"));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not mark as reviewed. Try again.");
    const button = screen.getByTestId("mark-reviewed") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fail = false;
    await userEvent.click(button);
    await waitFor(() => expect(screen.getByTestId("review-status").textContent).toBe("Marked as reviewed"));
    expect(calls.filter((c) => c.method === "POST").map((c) => (c.body as { version: number }).version)).toEqual([1, 1]);
  });

  it("disables the button while the report is being edited", () => {
    mockApi(() => ({ body: {} }));
    setup(report(), true);
    expect((screen.getByTestId("mark-reviewed") as HTMLButtonElement).disabled).toBe(true);
  });
});
