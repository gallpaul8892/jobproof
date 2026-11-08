import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { mockApi, problem, renderWithDataRouter } from "../../test/mockApi";
import { PRIYA, SARAH, customerRecord, report } from "../../test/fixtures";
import { EditReportForm } from "./EditReportForm";
import { EditCustomerForm } from "../customer/EditCustomerForm";

const ME = { id: PRIYA.id, full_name: PRIYA.name, email: "p@x.test", role: "manager" };
const stale = (current: Record<string, unknown> = {}) =>
  problem(409, "version_conflict", {
    current_version: 4,
    review_status: "awaiting_review",
    reviewed_by: null,
    reviewed_at: null,
    last_changed_by: SARAH,
    last_changed_at: "2026-10-15T10:40:00Z",
    current,
  });
const latestReport = (over: Parameters<typeof report>[0] = {}) =>
  report({ version: 4, last_changed_by: SARAH, last_changed_at: "2026-10-15T10:40:00Z", ...over });

type Req = { method: string; path: string; body: unknown };
function setupReport(handler: (req: Req) => ReturnType<Parameters<typeof mockApi>[0]>, r = report({ version: 3 })) {
  const calls = mockApi((req) => (req.path.endsWith("/auth/me") ? { body: ME } : handler(req)));
  const onSaved = vi.fn();
  const utils = renderWithDataRouter(<EditReportForm report={r} onSaved={onSaved} onClose={vi.fn()} onReload={async () => undefined} />);
  return { calls, patches: () => calls.filter((c) => c.method === "PATCH"), gets: () => calls.filter((c) => c.method === "GET"), onSaved, ...utils };
}

const painter = () => screen.getByLabelText("Operative notes") as HTMLTextAreaElement;
const manager = () => screen.getByLabelText("Manager notes (internal)") as HTMLTextAreaElement;
const save = () => screen.getByTestId("save-changes") as HTMLButtonElement;

/** Priya types manager notes, her save is refused (409), she clicks Apply my changes on top. */
async function conflictThenApply(latest: ReturnType<typeof report>) {
  let refused = false;
  const ctx = setupReport(({ method }) => {
    if (method !== "PATCH") return { body: latest };
    if (!refused) {
      refused = true;
      return stale();
    }
    return { body: { ...latest, version: 5 } };
  });
  fireEvent.change(manager(), { target: { value: "Customer asked for invoice by email." } });
  await userEvent.click(save());
  await screen.findByTestId("edit-conflict");
  await userEvent.click(screen.getByTestId("apply-on-top"));
  return ctx;
}

describe("Apply my changes on top (report form)", () => {
  it("offers it as the primary button next to Reload latest after a stale 409", async () => {
    setupReport(({ method }) => (method === "PATCH" ? stale() : { body: {} }));
    fireEvent.change(manager(), { target: { value: "x" } });
    await userEvent.click(save());
    const apply = await screen.findByTestId("apply-on-top");
    expect(apply.className).toContain("btn-primary");
    expect(apply.textContent).toBe("Apply my changes on top");
    expect(screen.getByTestId("reload-latest").className).not.toContain("btn-primary");
  });

  it("different fields: merges without a question, saves nothing until Save, then sends the new version", async () => {
    const { patches, onSaved } = await conflictThenApply(latestReport({ painter_notes: "Sarah's new painter notes" }));
    const notice = await screen.findByTestId("merge-notice");
    expect(notice.textContent).toBe(
      "Your changes were re-applied to the latest version (changed by Sarah Whitfield at 11:40). Check them and save.",
    );
    expect(notice.getAttribute("role")).toBe("status");
    expect(painter().value).toBe("Sarah's new painter notes");
    expect(manager().value).toBe("Customer asked for invoice by email.");
    expect(screen.getByTestId("reapplied-tag").textContent).toBe("Re-applied");
    expect(screen.queryByTestId("edit-conflict")).toBeNull();
    expect(patches()).toHaveLength(1); // only the refused one: nothing was saved automatically
    expect(save().disabled).toBe(false);
    expect(document.activeElement).toBe(notice);

    // the next PATCH succeeds
    await userEvent.click(save());
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(patches()[1]!.body).toEqual({ version: 4, manager_notes: "Customer asked for invoice by email." });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("same field: shows a labelled Keep mine / Keep theirs group, read-only and Save disabled until chosen", async () => {
    const latest = latestReport({ manager_notes: "Sarah's manager notes" });
    await conflictThenApply(latest);
    const group = await screen.findByRole("group", { name: "Manager notes: changed by you and by Sarah Whitfield" });
    expect(group.tagName).toBe("FIELDSET");
    expect(document.activeElement).toBe(group);
    const mine = within(group).getByRole("radio", { name: "Keep mine" }) as HTMLInputElement;
    const theirs = within(group).getByRole("radio", { name: "Keep theirs" }) as HTMLInputElement;
    expect(mine.checked || theirs.checked).toBe(false);
    expect(within(group).getByText("Customer asked for invoice by email.")).toBeTruthy();
    expect(within(group).getByText("Sarah's manager notes")).toBeTruthy();
    expect(manager().readOnly).toBe(true);
    expect(manager().value).toBe("Sarah's manager notes");
    expect(save().disabled).toBe(true);
    expect(screen.getByTestId("clash-hint").textContent).toBe("Choose a version for each field marked as changed by both of you.");

    await userEvent.click(mine);
    expect(manager().readOnly).toBe(false);
    expect(manager().value).toBe("Customer asked for invoice by email.");
    expect(save().disabled).toBe(false);
    expect(screen.queryByTestId("clash-hint")).toBeNull();
  });

  it("the choice is reachable and selectable by keyboard", async () => {
    await conflictThenApply(latestReport({ manager_notes: "S" }));
    const group = await screen.findByRole("group", { name: /Manager notes: changed by you/ });
    const mine = within(group).getByRole("radio", { name: "Keep mine" });
    mine.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect((within(group).getByRole("radio", { name: "Keep theirs" }) as HTMLInputElement).checked).toBe(true);
    expect(manager().value).toBe("S");
  });

  it("keep theirs on the only clash leaves nothing to save", async () => {
    await conflictThenApply(latestReport({ manager_notes: "Sarah's" }));
    await userEvent.click(await screen.findByRole("radio", { name: "Keep theirs" }));
    expect(screen.getByTestId("merge-nothing-left").textContent).toBe(
      "Nothing left to save: the latest version already has the values you kept.",
    );
    expect(save().disabled).toBe(true);
  });

  it("both made the same change: no clash and the field is not sent", async () => {
    const { patches } = await conflictThenApply(
      latestReport({
        checklist: [
          { id: "c1", label: "Skirting boards gloss", done: true, note: null },
          { id: "c2", label: "Ceilings", done: true, note: "Done twice" },
        ],
      }),
    );
    await screen.findByTestId("merge-notice");
    expect(screen.queryByTestId("edit-check-done-clash")).toBeNull();
    await userEvent.click(save());
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(patches()[1]!.body).toEqual({ version: 4, manager_notes: "Customer asked for invoice by email." });
  });

  it("shows the reopen warning when the latest version was reviewed meanwhile", async () => {
    setupReport(({ method }) =>
      method === "PATCH"
        ? stale()
        : { body: latestReport({ review_status: "reviewed", reviewed_by: SARAH, reviewed_at: "2026-10-15T10:40:00Z" }) },
    );
    expect(screen.queryByTestId("reopen-notice")).toBeNull();
    fireEvent.change(manager(), { target: { value: "x" } });
    await userEvent.click(save());
    await userEvent.click(await screen.findByTestId("apply-on-top"));
    expect((await screen.findByTestId("reopen-notice")).textContent).toBe(
      "This report has been reviewed. Saving changes will return it to Awaiting review.",
    );
  });

  it("a second conflict offers both buttons again and merges against the previous latest, keeping earlier choices", async () => {
    let latest = latestReport({ manager_notes: "Sarah v4" });
    let patchCount = 0;
    const { patches } = setupReport(({ method }) => {
      if (method === "PATCH") {
        patchCount += 1;
        if (patchCount <= 2) return stale();
        return { body: latestReport({ version: 6 }) };
      }
      return { body: latest };
    });
    fireEvent.change(manager(), { target: { value: "Priya" } });
    await userEvent.click(save());
    await userEvent.click(await screen.findByTestId("apply-on-top"));
    await userEvent.click(await screen.findByRole("radio", { name: "Keep mine" }));
    expect(manager().value).toBe("Priya");

    // Sarah saves again (version 5, painter notes) before Priya does.
    latest = latestReport({ version: 5, manager_notes: "Sarah v4", painter_notes: "Sarah painter v5" });
    await userEvent.click(save());
    expect(await screen.findByTestId("edit-conflict")).toBeTruthy();
    // The old merge display must not contradict the new conflict.
    expect(screen.queryByTestId("merge-notice")).toBeNull();
    expect(screen.queryByTestId("manager-notes-clash")).toBeNull();
    expect(screen.queryByTestId("reapplied-tag")).toBeNull();
    expect(screen.getByTestId("apply-on-top")).toBeTruthy();
    expect(screen.getByTestId("reload-latest")).toBeTruthy();
    await userEvent.click(screen.getByTestId("apply-on-top"));
    await waitFor(() => expect(painter().value).toBe("Sarah painter v5"));
    // Her earlier choice ("Priya") is her value; base was v4, so manager notes is a re-applied change, not a new clash.
    expect(manager().value).toBe("Priya");
    expect(screen.queryByTestId("manager-notes-clash")).toBeNull();
    await userEvent.click(save());
    await waitFor(() => expect(patches()).toHaveLength(3));
    expect(patches()[2]!.body).toEqual({ version: 5, manager_notes: "Priya" });
  });

  it("a failed load shows Try again and leaves the typed values and the conflict view alone", async () => {
    let failGet = true;
    const { gets } = setupReport(({ method }) => {
      if (method === "PATCH") return stale({ manager_notes: "Sarah's" });
      return failGet ? problem(500, "internal_error") : { body: latestReport({ painter_notes: "Sarah" }) };
    });
    fireEvent.change(manager(), { target: { value: "Mine" } });
    await userEvent.click(save());
    await userEvent.click(await screen.findByTestId("apply-on-top"));
    const failed = await screen.findByTestId("apply-failed");
    expect(failed.textContent).toContain("Could not load the latest version.");
    expect(manager().value).toBe("Mine");
    expect(screen.getByTestId("edit-conflict")).toBeTruthy();
    expect(screen.queryByTestId("merge-notice")).toBeNull();
    expect(gets().length).toBeGreaterThan(0);
    failGet = false;
    await userEvent.click(screen.getByTestId("apply-retry"));
    expect(await screen.findByTestId("merge-notice")).toBeTruthy();
  });

  it("checklist notes: a clash names the item and long values are shown as text in a scroll box", async () => {
    const long = "L".repeat(1200);
    setupReport(
      ({ method }) =>
        method === "PATCH"
          ? stale()
          : {
              body: latestReport({
                checklist: [
                  { id: "c1", label: "Skirting boards gloss", done: false, note: "Second coat 17 Oct" },
                  { id: "c2", label: "Ceilings", done: true, note: "Done twice" },
                ],
              }),
            },
    );
    fireEvent.change(screen.getByLabelText("Note for Skirting boards gloss"), { target: { value: "<b>mine</b>" } });
    fireEvent.change(manager(), { target: { value: `<b>${long}</b>` } });
    await userEvent.click(save());
    await userEvent.click(await screen.findByTestId("apply-on-top"));
    const group = await screen.findByRole("group", { name: "Checklist: Skirting boards gloss (note): changed by you and by Sarah Whitfield" });
    expect(within(group).getByText("<b>mine</b>")).toBeTruthy();
    expect(within(group).getByText("Second coat 17 Oct")).toBeTruthy();
    expect(within(group).getByRole("group", { name: "Your value" }).getAttribute("tabindex")).toBe("0");
    expect(document.querySelector("b")).toBeNull();
  });
});

describe("Apply my changes on top (customer form)", () => {
  const ME2 = ME;
  function setupCustomer(handler: (req: Req) => ReturnType<Parameters<typeof mockApi>[0]>) {
    const calls = mockApi((req) => (req.path.endsWith("/auth/me") ? { body: ME2 } : handler(req)));
    const onSaved = vi.fn();
    renderWithDataRouter(
      <EditCustomerForm customer={customerRecord()} onSaved={onSaved} onClose={vi.fn()} onReload={async () => undefined} />,
    );
    return { patches: () => calls.filter((c) => c.method === "PATCH"), onSaved };
  }
  const email = () => screen.getByLabelText("Email") as HTMLInputElement;
  const phone = () => screen.getByLabelText("Phone") as HTMLInputElement;
  const latestCustomer = (over: Parameters<typeof customerRecord>[0]) =>
    customerRecord({ version: 3, last_changed_by: SARAH, last_changed_at: "2026-10-15T10:40:00Z", ...over });

  it("phone by Sarah and email by Priya merge, ready to save", async () => {
    const { patches } = setupCustomer(({ method }) =>
      method === "PATCH" ? stale({ email: "x" }) : { body: latestCustomer({ phone: "0117 496 0123" }) },
    );
    fireEvent.change(email(), { target: { value: "priya@x.test" } });
    await userEvent.click(save());
    await userEvent.click(await screen.findByTestId("apply-on-top"));
    expect((await screen.findByTestId("merge-notice")).textContent).toContain("changed by Sarah Whitfield at 11:40");
    expect(phone().value).toBe("0117 496 0123");
    expect(email().value).toBe("priya@x.test");
    expect(patches()).toHaveLength(1);
    expect(save().disabled).toBe(false);
    await userEvent.click(save());
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(patches()[1]!.body).toEqual({ version: 3, email: "priya@x.test" });
  });

  it("both changing the email gives a Keep mine / Keep theirs choice", async () => {
    setupCustomer(({ method }) => (method === "PATCH" ? stale({ email: "x" }) : { body: latestCustomer({ email: "sarah@x.test" }) }));
    fireEvent.change(email(), { target: { value: "priya@x.test" } });
    await userEvent.click(save());
    await userEvent.click(await screen.findByTestId("apply-on-top"));
    const group = await screen.findByRole("group", { name: "Email: changed by you and by Sarah Whitfield" });
    expect(email().readOnly).toBe(true);
    expect(save().disabled).toBe(true);
    await userEvent.click(within(group).getByRole("radio", { name: "Keep mine" }));
    expect(email().value).toBe("priya@x.test");
    expect(save().disabled).toBe(false);
  });

  it("a failed load leaves everything unchanged", async () => {
    setupCustomer(({ method }) => (method === "PATCH" ? stale({ email: "x" }) : problem(500, "internal_error")));
    fireEvent.change(email(), { target: { value: "priya@x.test" } });
    await userEvent.click(save());
    await userEvent.click(await screen.findByTestId("apply-on-top"));
    expect(await screen.findByTestId("apply-failed")).toBeTruthy();
    expect(email().value).toBe("priya@x.test");
    expect(screen.getByTestId("edit-conflict")).toBeTruthy();
  });
});

describe("text typed while the latest version loads is kept", () => {
  function gate() {
    let release: () => void = () => undefined;
    const promise = new Promise<void>((r) => (release = r));
    return { promise, release };
  }

  it("report form", async () => {
    const g = gate();
    setupReport(async ({ method }) => {
      if (method === "PATCH") return stale();
      await g.promise;
      return { body: latestReport({ checklist: report().checklist.map((i, n) => (n === 0 ? { ...i, note: "Sarah's note" } : i)) }) };
    });
    fireEvent.change(manager(), { target: { value: "Mine" } });
    await userEvent.click(save());
    await userEvent.click(await screen.findByTestId("apply-on-top"));
    await screen.findByText("Loading latest...");
    // The inputs are read-only while loading ...
    expect(manager().readOnly).toBe(true);
    expect(painter().readOnly).toBe(true);
    // ... and even a change that gets through (paste, autofill) survives the merge.
    fireEvent.change(manager(), { target: { value: "Mine, and more typed while loading" } });
    fireEvent.change(painter(), { target: { value: "Typed in another field" } });
    g.release();
    await screen.findByTestId("merge-notice");
    expect(manager().value).toBe("Mine, and more typed while loading");
    expect(painter().value).toBe("Typed in another field");
    expect(manager().readOnly).toBe(false);
    const ids = manager().getAttribute("aria-describedby")!.split(" ");
    const tag = ids.map((i) => document.getElementById(i)).find((e) => e?.dataset.testid === "reapplied-tag");
    expect(tag?.textContent).toBe("Re-applied");
  });

  it("customer form", async () => {
    const g = gate();
    const calls = mockApi(async (req) => {
      if (req.path.endsWith("/auth/me")) return { body: ME };
      if (req.method === "PATCH") return stale({ email: "x" });
      await g.promise;
      return { body: customerRecord({ version: 3, last_changed_by: SARAH, last_changed_at: "2026-10-15T10:40:00Z", phone: "0117 496 0123" }) };
    });
    renderWithDataRouter(
      <EditCustomerForm customer={customerRecord()} onSaved={vi.fn()} onClose={vi.fn()} onReload={async () => undefined} />,
    );
    const email = () => screen.getByLabelText("Email") as HTMLInputElement;
    const town = () => screen.getByLabelText("Town or city") as HTMLInputElement;
    fireEvent.change(email(), { target: { value: "priya@x.test" } });
    await userEvent.click(save());
    await userEvent.click(await screen.findByTestId("apply-on-top"));
    await screen.findByText("Loading latest...");
    expect(email().readOnly).toBe(true);
    expect(town().readOnly).toBe(true);
    fireEvent.change(email(), { target: { value: "priya.long@x.test" } });
    fireEvent.change(town(), { target: { value: "Bath" } });
    g.release();
    await screen.findByTestId("merge-notice");
    expect(email().value).toBe("priya.long@x.test");
    expect(town().value).toBe("Bath");
    expect((screen.getByLabelText("Phone") as HTMLInputElement).value).toBe("0117 496 0123");
    expect(email().readOnly).toBe(false);
    const tag = screen.getAllByTestId("reapplied-tag")[0]!;
    expect(email().getAttribute("aria-describedby")).toContain(tag.id);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  });

  it("customer form: a second 409 clears the merge notice and tags", async () => {
    let patchCount = 0;
    mockApi(async (req) => {
      if (req.path.endsWith("/auth/me")) return { body: ME };
      if (req.method === "PATCH") {
        patchCount += 1;
        return stale({ email: "x" });
      }
      return { body: customerRecord({ version: 3, last_changed_by: SARAH, last_changed_at: "2026-10-15T10:40:00Z", phone: "0117 496 0123" }) };
    });
    renderWithDataRouter(
      <EditCustomerForm customer={customerRecord()} onSaved={vi.fn()} onClose={vi.fn()} onReload={async () => undefined} />,
    );
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "priya@x.test" } });
    await userEvent.click(save());
    await userEvent.click(await screen.findByTestId("apply-on-top"));
    await screen.findByTestId("merge-notice");
    await userEvent.click(save());
    await screen.findByTestId("edit-conflict");
    expect(patchCount).toBe(2);
    expect(screen.queryByTestId("merge-notice")).toBeNull();
    expect(screen.queryByTestId("reapplied-tag")).toBeNull();
  });
});
