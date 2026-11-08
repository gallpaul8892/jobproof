import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { mockApi, problem, renderWithDataRouter } from "../../test/mockApi";
import { PRIYA, SARAH, customerRecord } from "../../test/fixtures";
import { EditCustomerForm } from "./EditCustomerForm";

const ME = { id: PRIYA.id, full_name: PRIYA.name, email: "p@x.test", role: "manager" };
const conflict409 = (current: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  problem(409, "version_conflict", {
    current_version: 3,
    last_changed_by: SARAH,
    last_changed_at: "2026-10-15T10:40:00Z",
    current,
    ...extra,
  });

function setup(handler: Parameters<typeof mockApi>[0], c = customerRecord()) {
  const calls = mockApi((req) => (req.path.endsWith("/auth/me") ? { body: ME } : handler(req)));
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const onReload = vi.fn(async () => undefined);
  const utils = renderWithDataRouter(<EditCustomerForm customer={c} onSaved={onSaved} onClose={onClose} onReload={onReload} />);
  return { calls, patches: () => calls.filter((x) => x.method === "PATCH"), onSaved, onClose, onReload, ...utils };
}

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const save = () => screen.getByTestId("save-changes") as HTMLButtonElement;

describe("EditCustomerForm", () => {
  it("shows labelled fields with the saved values, Save disabled and the impact notice", () => {
    setup(() => ({ body: {} }));
    expect(input("Name").value).toBe("Harbourside Lettings Ltd");
    expect(input("Contact name").value).toBe("Marcus Ellery");
    expect(input("Email").type).toBe("email");
    expect(input("Phone").type).toBe("tel");
    expect(input("Address line 1").value).toBe("Unit 4");
    expect(input("Town or city").value).toBe("Bristol");
    expect(input("County").value).toBe("City of Bristol");
    expect(input("Postcode").value).toBe("BS1 4SB");
    expect(input("Email").autocomplete).toBe("off");
    expect(save().disabled).toBe(true);
    const notice = screen.getByTestId("impact-notice");
    expect(notice.getAttribute("role")).toBe("status");
    expect(notice.textContent).toBe(
      "These details are used on 12 jobs, 12 reports (9 reviewed) and 7 issued invoices. Changes will show on all of them. Reviewed reports stay reviewed.",
    );
  });

  it("sends only the changed fields with the loaded version", async () => {
    const { patches, onSaved } = setup(() => ({ body: customerRecord({ version: 3 }) }));
    fireEvent.change(input("Phone"), { target: { value: "0117 496 0123" } });
    fireEvent.change(input("Postcode"), { target: { value: "bs1 4sa" } });
    await userEvent.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(false));
    expect(patches()[0]!.body).toEqual({ version: 2, phone: "0117 496 0123", billing_address: { postcode: "BS1 4SA" } });
  });

  it("shows the field messages beside the fields and disables Save", () => {
    setup(() => ({ body: {} }));
    fireEvent.change(input("Postcode"), { target: { value: "BS1" } });
    fireEvent.change(input("Phone"), { target: { value: "12345" } });
    fireEvent.change(input("Email"), { target: { value: "accounts at harbourside" } });
    fireEvent.change(input("Name"), { target: { value: "" } });
    expect(screen.getByTestId("postcode-error").textContent).toBe("Enter a UK postcode such as BS6 5QA.");
    expect(screen.getByTestId("phone-error").textContent).toContain("Enter a UK phone number such as 07700 900123");
    expect(screen.getByTestId("email-error").textContent).toBe("Enter an email address such as name@example.co.uk.");
    expect(screen.getByTestId("name-error").textContent).toBe("Enter a name.");
    expect(input("Postcode").getAttribute("aria-invalid")).toBe("true");
    expect(save().disabled).toBe(true);
  });

  it("refuses control characters and over-long values with a counter", () => {
    setup(() => ({ body: {} }));
    fireEvent.change(input("Name"), { target: { value: "a​b" } });
    expect(screen.getByTestId("name-error").textContent).toBe("Remove control characters.");
    fireEvent.change(input("Name"), { target: { value: "x".repeat(121) } });
    expect(screen.getByTestId("name-error").textContent).toBe("Use 120 characters or fewer.");
    expect(screen.getByTestId("name-count").textContent).toBe("121 / 120");
  });

  it("clearing an optional field sends null", async () => {
    const { patches } = setup(() => ({ body: customerRecord({ version: 3 }) }));
    fireEvent.change(input("Email"), { target: { value: "" } });
    await userEvent.click(save());
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]!.body).toEqual({ version: 2, email: null });
  });

  it("maps a 422 to the field it names, including address parts", async () => {
    setup(() =>
      problem(422, "validation_error", {
        errors: [{ loc: ["body", "billing_address", "town"], message: "Server says no." }],
      }),
    );
    fireEvent.change(input("Town or city"), { target: { value: "Bath" } });
    await userEvent.click(save());
    expect((await screen.findByTestId("town-error")).textContent).toBe("Server says no.");
  });

  it("on a 409 keeps the typed values and shows the saved value beside the sent fields only", async () => {
    setup(() => conflict409({ email: "sarah@x.test" }));
    fireEvent.change(input("Email"), { target: { value: "priya@x.test" } });
    await userEvent.click(save());
    const alert = await screen.findByTestId("edit-conflict");
    expect(alert.textContent).toContain("Sarah Whitfield changed this customer at 11:40. Your changes were not saved.");
    expect(input("Email").value).toBe("priya@x.test");
    expect(within(screen.getByTestId("email-current")).getByText("sarah@x.test")).toBeTruthy();
    expect(screen.queryByTestId("phone-current")).toBeNull();
    expect(screen.getByTestId("apply-on-top").textContent).toBe("Apply my changes on top");
    expect(screen.getByTestId("reload-latest")).toBeTruthy();
  });

  it("treats a 409 that shows the user's own identical change as saved (lost reply)", async () => {
    const { onSaved } = setup(() => conflict409({ phone: "0117 496 0123" }, { last_changed_by: PRIYA }));
    fireEvent.change(input("Phone"), { target: { value: "0117 496 0123" } });
    await userEvent.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(true));
  });

  it("a 500 offers Try again with the same body", async () => {
    let fail = true;
    const { patches, onSaved } = setup(() => (fail ? problem(500, "internal_error") : { body: customerRecord({ version: 3 }) }));
    fireEvent.change(input("Name"), { target: { value: "New Name Ltd" } });
    await userEvent.click(save());
    await screen.findByTestId("edit-failure");
    expect(input("Name").value).toBe("New Name Ltd");
    fail = false;
    await userEvent.click(screen.getByTestId("edit-retry"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(patches()[1]!.body).toEqual(patches()[0]!.body);
  });

  it("renders markup as plain text", () => {
    setup(() => ({ body: {} }), customerRecord({ name: '<b>Smith</b> & "Sons"' }));
    expect(input("Name").value).toBe('<b>Smith</b> & "Sons"');
    expect(document.querySelector("b")).toBeNull();
  });

  it("Cancel is immediate when clean and asks when dirty", async () => {
    const { onClose } = setup(() => ({ body: {} }));
    await userEvent.click(screen.getByTestId("cancel-edit"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.change(input("Name"), { target: { value: "X" } });
    await userEvent.click(screen.getByTestId("cancel-edit"));
    expect(screen.getByRole("heading", { name: "Discard your changes?", hidden: true })).toBeTruthy();
  });
});
