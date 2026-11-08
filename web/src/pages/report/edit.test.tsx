import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { mockApi, problem, renderWithDataRouter } from "../../test/mockApi";
import { PRIYA, SARAH, report } from "../../test/fixtures";
import { EditReportForm } from "./EditReportForm";

const ME = { id: PRIYA.id, full_name: PRIYA.name, email: "p@x.test", role: "manager" };

function setup(
  handler: Parameters<typeof mockApi>[0],
  r = report(),
  reload: () => Promise<void> = async () => undefined,
) {
  const calls = mockApi((req) => (req.path.endsWith("/auth/me") ? { body: ME } : handler(req)));
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const onReload = vi.fn(reload);
  const utils = renderWithDataRouter(<EditReportForm report={r} onSaved={onSaved} onClose={onClose} onReload={onReload} />);
  const patches = () => calls.filter((c) => c.method === "PATCH");
  return { calls, patches, onSaved, onClose, onReload, ...utils };
}

const saveButton = () => screen.getByTestId("save-changes") as HTMLButtonElement;
const painter = () => screen.getByLabelText("Operative notes") as HTMLTextAreaElement;

describe("EditReportForm", () => {
  it("starts with the saved values, labelled controls, and Save disabled", () => {
    setup(() => ({ body: {} }));
    expect(painter().value).toBe("Two coats applied.");
    expect(screen.getByLabelText("Manager notes (internal)")).toBeTruthy();
    expect(screen.getByLabelText("Done, Ceilings")).toBeTruthy();
    expect((screen.getByLabelText("Note for Ceilings") as HTMLInputElement).value).toBe("Done twice");
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByTestId("painter-notes-count").textContent).toBe("18 / 5,000");
    expect(screen.queryByTestId("reopen-notice")).toBeNull();
  });

  it("over the limit shows the message, marks the field invalid and disables Save", async () => {
    setup(() => ({ body: {} }));
    fireEvent.change(painter(), { target: { value: "x".repeat(5001) } });
    expect(screen.getByTestId("painter-notes-error").textContent).toBe("Use 5,000 characters or fewer.");
    expect(painter().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByTestId("painter-notes-count").textContent).toBe("5,001 / 5,000");
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(painter(), { target: { value: "x".repeat(5000) } });
    expect(screen.getByTestId("painter-notes-error").textContent).toBe("");
    expect(saveButton().disabled).toBe(false);
  });

  it("a checklist note over 500 characters is refused", () => {
    setup(() => ({ body: {} }));
    fireEvent.change(screen.getByLabelText("Note for Ceilings"), { target: { value: "n".repeat(501) } });
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByText("Use 500 characters or fewer.")).toBeTruthy();
  });

  it("sends only what changed with the loaded version, and reports the save", async () => {
    const saved = report({ version: 2 });
    const { patches, onSaved } = setup(() => ({ body: saved }));
    await userEvent.type(painter(), " More.");
    await userEvent.click(screen.getByLabelText("Done, Skirting boards gloss"));
    await userEvent.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(false));
    expect(patches()).toHaveLength(1);
    expect(patches()[0]!.body).toEqual({
      version: 1,
      painter_notes: "Two coats applied. More.",
      checklist: [{ id: "c1", done: true }],
    });
  });

  it("shows Saving... and sends one request on a double click", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const { patches } = setup(async () => {
      await gate;
      return { body: report({ version: 2 }) };
    });
    await userEvent.type(painter(), "!");
    await userEvent.dblClick(saveButton());
    expect(await screen.findByRole("button", { name: "Saving..." })).toBeTruthy();
    release();
    await waitFor(() => expect(patches()).toHaveLength(1));
  });

  it("on a version conflict keeps the typed text and shows the other manager's current values", async () => {
    const { onSaved } = setup(() =>
      problem(409, "version_conflict", {
        current_version: 2,
        review_status: "awaiting_review",
        reviewed_by: null,
        reviewed_at: null,
        last_changed_by: SARAH,
        last_changed_at: "2026-10-15T10:40:00Z",
        current: { painter_notes: "Sarah's text", checklist: [{ id: "c1", done: true, note: "Sarah note" }] },
      }),
    );
    await userEvent.clear(painter());
    await userEvent.type(painter(), "Priya's text");
    await userEvent.click(screen.getByLabelText("Done, Skirting boards gloss"));
    await userEvent.click(saveButton());
    const alert = await screen.findByTestId("edit-conflict");
    expect(alert.textContent).toContain("Sarah Whitfield changed this report at 11:40. Your changes were not saved.");
    expect(painter().value).toBe("Priya's text");
    expect(within(screen.getByTestId("painter-notes-current")).getByText("Sarah's text")).toBeTruthy();
    expect(screen.getByTestId("edit-check-current").textContent).toContain("Done. Note: Sarah note");
    // The manager-notes field was not sent, so it shows no saved value.
    expect(screen.queryByTestId("manager-notes-current")).toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("Reload latest asks first, then reloads", async () => {
    const { onReload } = setup(() =>
      problem(409, "version_conflict", {
        current_version: 2,
        review_status: "awaiting_review",
        last_changed_by: SARAH,
        last_changed_at: "2026-10-15T10:40:00Z",
        current: { painter_notes: "S" },
      }),
    );
    await userEvent.type(painter(), "!");
    await userEvent.click(saveButton());
    await userEvent.click(await screen.findByTestId("reload-latest"));
    expect(screen.getByRole("heading", { name: "Discard your edits and load the latest version?", hidden: true })).toBeTruthy();
    await userEvent.click(screen.getByTestId("reload-dialog-cancel"));
    expect(onReload).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("reload-latest"));
    await userEvent.click(screen.getByTestId("reload-dialog-confirm"));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("keeps the typed text and the conflict view, with an error, when the reload fails", async () => {
    const { onReload } = setup(
      () =>
        problem(409, "version_conflict", {
          current_version: 2,
          review_status: "awaiting_review",
          last_changed_by: SARAH,
          last_changed_at: "2026-10-15T10:40:00Z",
          current: { painter_notes: "S" },
        }),
      report(),
      async () => {
        throw new Error("offline");
      },
    );
    await userEvent.type(painter(), "!");
    const typed = painter().value;
    await userEvent.click(saveButton());
    await userEvent.click(await screen.findByTestId("reload-latest"));
    await userEvent.click(screen.getByTestId("reload-dialog-confirm"));
    const failed = await screen.findByTestId("reload-failed");
    expect(failed.textContent).toBe("Could not load the latest version. Try again.");
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(painter().value).toBe(typed);
    expect(screen.getByTestId("edit-conflict")).toBeTruthy();
  });

  it("treats a 409 that shows the user's own identical change as saved (lost reply)", async () => {
    const { onSaved } = setup(() =>
      problem(409, "version_conflict", {
        current_version: 2,
        review_status: "awaiting_review",
        last_changed_by: PRIYA,
        last_changed_at: "2026-10-15T10:40:00Z",
        current: { painter_notes: "Two coats applied.!" },
      }),
    );
    await userEvent.type(painter(), "!");
    await userEvent.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(true));
    expect(screen.queryByTestId("edit-conflict")).toBeNull();
  });

  it("a 403 keeps the typed text and says so", async () => {
    setup(() => problem(403, "forbidden"));
    await userEvent.type(painter(), "!");
    await userEvent.click(saveButton());
    expect((await screen.findByTestId("edit-forbidden")).textContent).toBe("You no longer have permission to edit this report.");
    expect(painter().value).toBe("Two coats applied.!");
  });

  it("a 500 offers Try again, which resubmits the same body and version", async () => {
    let fail = true;
    const { patches, onSaved } = setup(() => (fail ? problem(500, "internal_error") : { body: report({ version: 2 }) }));
    await userEvent.type(painter(), "!");
    await userEvent.click(saveButton());
    await screen.findByTestId("edit-failure");
    expect(painter().value).toBe("Two coats applied.!");
    fail = false;
    await userEvent.click(screen.getByTestId("edit-retry"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(patches().map((c) => c.body)).toEqual([patches()[0]!.body, patches()[0]!.body]);
  });

  it("maps a 422 to the field it names", async () => {
    setup(() =>
      problem(422, "validation_error", {
        errors: [{ loc: ["body", "checklist", 0, "note"], message: "Too long for the server." }],
      }),
    );
    await userEvent.click(screen.getByLabelText("Done, Skirting boards gloss"));
    await userEvent.type(screen.getByLabelText("Note for Skirting boards gloss"), "n");
    await userEvent.click(saveButton());
    expect(await screen.findByText("Too long for the server.")).toBeTruthy();
  });

  it("warns on a reviewed report that saving returns it to Awaiting review", () => {
    setup(
      () => ({ body: {} }),
      report({ review_status: "reviewed", reviewed_by: SARAH, reviewed_at: "2026-10-12T08:15:00Z", version: 2 }),
    );
    const notice = screen.getByTestId("reopen-notice");
    expect(notice.getAttribute("role")).toBe("status");
    expect(notice.textContent).toBe("This report has been reviewed. Saving changes will return it to Awaiting review.");
  });

  it("Cancel leaves at once when clean and asks first when there are changes", async () => {
    const { onClose } = setup(() => ({ body: {} }));
    await userEvent.click(screen.getByTestId("cancel-edit"));
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.type(painter(), "!");
    await userEvent.click(screen.getByTestId("cancel-edit"));
    expect(screen.getByRole("heading", { name: "Discard your changes?", hidden: true })).toBeTruthy();
    await userEvent.click(screen.getByTestId("discard-dialog-cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByTestId("cancel-edit"));
    await userEvent.click(screen.getByTestId("discard-dialog-confirm"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("blocks in-app navigation while dirty and registers beforeunload, only while dirty", async () => {
    const { router } = setup(() => ({ body: {} }));
    const unload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(unload()).toBe(false);
    await userEvent.type(painter(), "!");
    expect(unload()).toBe(true);

    await act(async () => {
      await router.navigate("/elsewhere");
    });
    expect(router.state.location.pathname).toBe("/");
    expect(screen.getByRole("heading", { name: "Leave without saving?", hidden: true })).toBeTruthy();
    await userEvent.click(screen.getByTestId("leave-dialog-cancel"));
    expect(router.state.location.pathname).toBe("/");

    await act(async () => {
      await router.navigate("/elsewhere");
    });
    await userEvent.click(screen.getByTestId("leave-dialog-confirm"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/elsewhere"));
  });

  it("renders markup and long text as plain text", async () => {
    setup(() => ({ body: {} }), report({ painter_notes: '<b>bold</b> & "quotes"' }));
    expect(painter().value).toBe('<b>bold</b> & "quotes"');
    expect(document.querySelector("b")).toBeNull();
  });
});
