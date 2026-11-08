import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuditEvent } from "@jobproof/shared";
import { describe, expect, it } from "vitest";
import { mockApi, problem, renderApp } from "../../test/mockApi";
import { PRIYA, SARAH } from "../../test/fixtures";
import { HistoryPanel } from "./HistoryPanel";

const ev = (n: number, over: Partial<AuditEvent> = {}): AuditEvent => ({
  id: `e${n}`,
  occurred_at: "2026-10-15T10:42:00Z",
  actor: PRIYA,
  action: "report.reviewed",
  changes: [],
  ...over,
});

describe("HistoryPanel", () => {
  it("shows events newest first with London time, sentences and before/after", async () => {
    mockApi(() => ({
      body: {
        total: 3,
        items: [
          ev(3, { action: "report.reopened", changes: [
            { field: "reviewed_by", item_id: null, item_label: null, old_value: "Sarah Whitfield", new_value: null },
            { field: "reviewed_at", item_id: null, item_label: null, old_value: "2026-10-12T08:15:00Z", new_value: null },
          ] }),
          ev(2, { action: "report.edited", changes: [
            { field: "painter_notes", item_id: null, item_label: null, old_value: "Old", new_value: "New" },
            { field: "checklist_done", item_id: "c1", item_label: "Skirting boards gloss", old_value: false, new_value: true },
          ] }),
          ev(1, { actor: SARAH, occurred_at: "2026-10-12T08:15:00Z" }),
        ],
      },
    }));
    renderApp(<HistoryPanel reportId="r1" />);
    const events = await screen.findAllByTestId("history-event");
    expect(events).toHaveLength(3);
    const sentences = screen.getAllByTestId("history-sentence").map((e) => e.textContent);
    expect(sentences).toEqual([
      "Report returned to Awaiting review (previously reviewed by Sarah Whitfield on 12 Oct 2026, 09:15)",
      "Priya Nair changed Operative notes, Checklist: Skirting boards gloss",
      "Sarah Whitfield marked the report as reviewed",
    ]);
    expect(events[0]!.textContent).toContain("15 Oct 2026, 11:42");
    const changes = within(events[1]!).getAllByTestId("history-change");
    expect(within(changes[0]!).getByTestId("history-before").textContent).toBe("Old");
    expect(within(changes[0]!).getByTestId("history-after").textContent).toBe("New");
    expect(changes[1]!.textContent).toContain("Not done");
    expect(changes[1]!.textContent).toContain("Done");
  });

  it("cuts a long value at 200 characters with a toggle", async () => {
    const long = "y".repeat(250);
    mockApi(() => ({
      body: {
        total: 1,
        items: [ev(1, { action: "report.edited", changes: [
          { field: "manager_notes", item_id: null, item_label: null, old_value: null, new_value: long },
        ] })],
      },
    }));
    renderApp(<HistoryPanel reportId="r1" />);
    const after = await screen.findByTestId("history-after");
    expect(after.textContent).toBe("y".repeat(200) + "…");
    const toggle = screen.getByTestId("history-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);
    expect(screen.getByTestId("history-after").textContent).toBe(long);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("empty state", async () => {
    mockApi(() => ({ body: { items: [], total: 0 } }));
    renderApp(<HistoryPanel reportId="r1" />);
    expect((await screen.findByTestId("history-empty")).textContent).toBe("No changes recorded yet.");
  });

  it("says when only the latest 100 are shown", async () => {
    mockApi(() => ({ body: { items: [ev(1)], total: 130 } }));
    renderApp(<HistoryPanel reportId="r1" />);
    expect((await screen.findByTestId("history-more")).textContent).toBe("Showing the latest 100 of 130 changes.");
  });

  it("shows a skeleton, then an error with Try again that recovers", async () => {
    let fail = true;
    mockApi(() => (fail ? problem(500, "internal_error") : { body: { items: [], total: 0 } }));
    renderApp(<HistoryPanel reportId="r1" />);
    expect(screen.getByTestId("loading-state")).toBeTruthy();
    const error = await screen.findByTestId("error-state", {}, { timeout: 5000 });
    expect(error.textContent).toContain("loading the history");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByTestId("history-empty")).toBeTruthy());
  });
});
