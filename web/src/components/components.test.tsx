import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { ApiError, type ReportPhoto } from "@jobproof/shared";
import { describe, expect, it } from "vitest";
import { PhotoGallery } from "./PhotoGallery";
import { QueryBoundary } from "./QueryBoundary";
import { BillingBadge, Pagination, resultLine } from "./ui";

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function Probe({ fn }: { fn: () => Promise<string> }) {
  const query = useQuery({ queryKey: ["probe"], queryFn: fn });
  return (
    <QueryBoundary query={query} what="things">
      {(data) => <p>data: {data}</p>}
    </QueryBoundary>
  );
}

describe("QueryBoundary", () => {
  it("shows loading, then data", async () => {
    wrap(<Probe fn={async () => "ok"} />);
    expect(screen.getByTestId("loading-state")).toBeTruthy();
    expect(await screen.findByText("data: ok")).toBeTruthy();
  });

  it("shows a network error with Try again that recovers", async () => {
    let up = false;
    wrap(
      <Probe
        fn={async () => {
          if (!up) throw new ApiError({ status: 0, code: "network_error", title: "Cannot reach the API" });
          return "back";
        }}
      />,
    );
    expect(await screen.findByTestId("error-state")).toBeTruthy();
    expect(screen.getByText(/Can't reach the server/)).toBeTruthy();
    up = true;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("data: back")).toBeTruthy();
  });

  it("shows the detail and request id for an API error", async () => {
    wrap(
      <Probe
        fn={async () => {
          throw new ApiError({ status: 500, code: "internal_error", title: "Boom", detail: "It broke", requestId: "r-1" });
        }}
      />,
    );
    expect(await screen.findByText("It broke")).toBeTruthy();
    expect(screen.getByText("Ref: r-1")).toBeTruthy();
  });
});

describe("ui helpers", () => {
  it("formats the result line", () => {
    expect(resultLine(2, 20, 60, 20, "reports")).toBe("Showing 21-40 of 60 reports");
    expect(resultLine(3, 20, 52, 12, "invoices")).toBe("Showing 41-52 of 52 invoices");
    expect(resultLine(1, 20, 0, 0, "reports")).toBe("0 reports");
  });

  it("badges carry text, not just colour", () => {
    render(<BillingBadge status="part_paid" />);
    expect(screen.getByText("Part paid")).toBeTruthy();
  });

  it("pagination disables the ends", async () => {
    const pages: number[] = [];
    render(<Pagination page={1} pageSize={20} total={60} noun="Reports" onPage={(p) => pages.push(p)} />);
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Page 1 of 3")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(pages).toEqual([2]);
  });
});

const photos: ReportPhoto[] = ["before", "during", "after"].map((stage, i) => ({
  id: `p${i}`,
  stage: stage as ReportPhoto["stage"],
  caption: `Caption ${i + 1}`,
  taken_at: "2026-11-05T09:14:00Z",
  width: 1600,
  height: 1200,
  url: `http://api.test/full/${i}`,
  thumb_url: `http://api.test/thumb/${i}`,
}));

describe("PhotoGallery", () => {
  it("groups photos by stage with counts", () => {
    render(<PhotoGallery photos={photos} />);
    expect(screen.getByRole("heading", { name: /Before/ }).textContent).toContain("(1)");
    expect(screen.getAllByTestId("photo-thumb")).toHaveLength(3);
  });

  it("says so when there are no photos", () => {
    render(<PhotoGallery photos={[]} />);
    expect(screen.getByText("No photos were submitted with this report.")).toBeTruthy();
  });

  it("opens the lightbox and moves with arrow keys and buttons", async () => {
    render(<PhotoGallery photos={photos} />);
    await userEvent.click(screen.getAllByTestId("photo-thumb")[0]);
    await waitFor(() => expect(screen.getByTestId("lightbox-position").textContent).toBe("1 of 3"));
    fireEvent.keyDown(screen.getByTestId("lightbox"), { key: "ArrowRight" });
    expect(screen.getByTestId("lightbox-position").textContent).toBe("2 of 3");
    fireEvent.keyDown(screen.getByTestId("lightbox"), { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByTestId("lightbox"), { key: "ArrowLeft" });
    expect(screen.getByTestId("lightbox-position").textContent).toBe("3 of 3");
    await userEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(screen.getByTestId("lightbox-position").textContent).toBe("1 of 3");
  });
});
