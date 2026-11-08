import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { summary } from "../../test/fixtures";
import { ReviewQueue } from "./ReviewQueue";

const AS_OF = "2026-10-15T10:42:00Z";
const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("ReviewQueue", () => {
  it("lists reports with waiting labels, Review links and a View all link", () => {
    wrap(<ReviewQueue items={[summary(1), summary(2), summary(3)]} awaitingCount={3} asOf={AS_OF} />);
    expect(screen.getByRole("heading", { name: "Review queue" })).toBeTruthy();
    const rows = screen.getAllByTestId("queue-row");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByTestId("queue-waiting").textContent).toBe("Waiting 4 days");
    expect(within(rows[2]!).getByTestId("queue-waiting").textContent).toBe("Waiting 2 days");
    const review = screen.getByRole("link", { name: "Review JP-101" });
    expect(review.getAttribute("href")).toBe("/reports/r1");
    const all = screen.getByRole("link", { name: "View all 3 awaiting review" });
    expect(all.getAttribute("href")).toBe("/reports?review_status=awaiting_review&sort=submitted_asc");
  });

  it("the link counts every report waiting, not only the rows shown", () => {
    wrap(<ReviewQueue items={[summary(1)]} awaitingCount={9} asOf={AS_OF} />);
    expect(screen.getByRole("link", { name: "View all 9 awaiting review" })).toBeTruthy();
  });

  it("says so when nothing is waiting, with no table and no link", () => {
    wrap(<ReviewQueue items={[]} awaitingCount={0} asOf={AS_OF} />);
    expect(screen.getByText("Nothing is waiting for review.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByTestId("queue-view-all")).toBeNull();
  });
});
