import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_THEME, type AdminSettings } from "@jobproof/shared";
import { describe, expect, it } from "vitest";
import { mockApi, problem, renderApp } from "../../test/mockApi";
import { ColourSchemeForm } from "./ColourSchemeForm";
import { CompanyNameForm } from "./CompanyNameForm";
import { ContactRulesForm } from "./ContactRulesForm";

const settings: AdminSettings = {
  company_name: "Oak Ltd",
  theme: { ...DEFAULT_THEME },
  uk_only_contact_details: true,
  updated_at: null,
  updated_by: null,
};
const ok = (over: Partial<AdminSettings> = {}) => ({ body: { ...settings, ...over } });

describe("CompanyNameForm", () => {
  it("disables Save when unchanged or invalid and counts characters", async () => {
    mockApi(() => ok());
    renderApp(<CompanyNameForm settings={settings} />);
    const save = screen.getByTestId("company-name-save") as HTMLButtonElement;
    const input = screen.getByLabelText("Company name");
    expect(save.disabled).toBe(true);
    expect(screen.getByTestId("company-name-count").textContent).toBe("7 / 60");

    await userEvent.clear(input);
    expect(screen.getByTestId("company-name-error").textContent).toBe("Enter a company name.");
    expect(save.disabled).toBe(true);

    await userEvent.type(input, "x".repeat(61));
    expect(screen.getByTestId("company-name-error").textContent).toBe("Use 60 characters or fewer.");
    expect(save.disabled).toBe(true);

    await userEvent.clear(input);
    await userEvent.type(input, "  Oak Ltd  ");
    expect(save.disabled).toBe(true); // same after trimming

    await userEvent.clear(input);
    await userEvent.type(input, "Elm Ltd");
    expect(save.disabled).toBe(false);
  });

  it("shows Saving... while pending, then Settings saved", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const calls = mockApi(async () => {
      await gate;
      return ok({ company_name: "Elm Ltd" });
    });
    renderApp(<CompanyNameForm settings={settings} />);
    const input = screen.getByLabelText("Company name");
    await userEvent.clear(input);
    await userEvent.type(input, "Elm Ltd");
    await userEvent.click(screen.getByTestId("company-name-save"));
    const pending = await screen.findByRole("button", { name: "Saving..." });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    release();
    expect((await screen.findByRole("status")).textContent).toBe("Settings saved");
    expect(calls[0]).toMatchObject({ method: "PATCH", path: "/api/v1/admin/settings", body: { company_name: "Elm Ltd" } });
  });

  it("shows a 422 message beside the field", async () => {
    mockApi(() =>
      problem(422, "validation_error", { errors: [{ loc: ["body", "company_name"], message: "Remove control characters." }] }),
    );
    renderApp(<CompanyNameForm settings={settings} />);
    const input = screen.getByLabelText("Company name");
    await userEvent.clear(input);
    await userEvent.type(input, "Elm Ltd");
    await userEvent.click(screen.getByTestId("company-name-save"));
    await waitFor(() => expect(screen.getByTestId("company-name-error").textContent).toBe("Remove control characters."));
  });

  it("keeps the typed value on a 500 and Try again resubmits", async () => {
    let fail = true;
    const calls = mockApi(() => (fail ? problem(500, "internal_error") : ok({ company_name: "Elm Ltd" })));
    renderApp(<CompanyNameForm settings={settings} />);
    const input = screen.getByLabelText("Company name") as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, "Elm Ltd");
    await userEvent.click(screen.getByTestId("company-name-save"));
    expect((await screen.findByRole("alert")).textContent).toContain("Could not save");
    expect(input.value).toBe("Elm Ltd");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect((await screen.findByRole("status")).textContent).toBe("Settings saved");
    expect(calls).toHaveLength(2);
  });
});

describe("ColourSchemeForm", () => {
  const navy = { primary: "#1F3A5F", accent: "#2B4C7E" };

  it("picking a preset fills both inputs and the preview, and enables Save", async () => {
    mockApi(() => ok({ theme: { ...DEFAULT_THEME, ...navy } }));
    renderApp(<ColourSchemeForm settings={settings} />);
    expect((screen.getByTestId("colour-save") as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByTestId("preset-navy"));
    expect((screen.getByTestId("colour-primary-input") as HTMLInputElement).value).toBe(navy.primary);
    expect((screen.getByTestId("colour-accent-input") as HTMLInputElement).value).toBe(navy.accent);
    expect(screen.getByTestId("theme-preview").getAttribute("data-primary")).toBe(navy.primary);
    expect(screen.getByTestId("colour-primary-ratio").textContent).toMatch(/:1 against the surface colour, passes$/);
    expect((screen.getByTestId("colour-save") as HTMLButtonElement).disabled).toBe(false);
  });

  it("a failing colour shows the ratio, disables Save and keeps the last valid preview", async () => {
    mockApi(() => ok());
    renderApp(<ColourSchemeForm settings={settings} />);
    const input = screen.getByTestId("colour-primary-input");
    await userEvent.clear(input);
    await userEvent.type(input, "#FFD400");
    expect(screen.getByTestId("colour-primary-ratio").textContent).toBe("1.32:1 against the surface colour, needs 4.5:1");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByTestId("colour-save") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("theme-preview").getAttribute("data-primary")).toBe(DEFAULT_THEME.primary);

    await userEvent.clear(input);
    await userEvent.type(input, "#12");
    expect(screen.getByTestId("colour-primary-ratio").textContent).toBe("Use a colour in the form #RRGGBB.");
  });

  it("shows the lower of the two ratios and names the background that fails", async () => {
    mockApi(() => ok());
    renderApp(<ColourSchemeForm settings={settings} />);
    const accent = screen.getByTestId("colour-accent-input");
    // #767676 is 4.54:1 on white (passes) but 4.20:1 on the surface colour (fails).
    await userEvent.clear(accent);
    await userEvent.type(accent, "#767676");
    expect(screen.getByTestId("colour-accent-ratio").textContent).toBe("4.20:1 against the surface colour, needs 4.5:1");
    expect(accent.getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByTestId("colour-save") as HTMLButtonElement).disabled).toBe(true);
    await userEvent.clear(accent);
    await userEvent.type(accent, "#717171");
    expect(screen.getByTestId("colour-accent-ratio").textContent).toBe("4.52:1 against the surface colour, passes");
    expect(accent.getAttribute("aria-invalid")).toBeNull();
  });

  it("accepts lower case and sends upper case", async () => {
    const calls = mockApi(() => ok({ theme: { ...DEFAULT_THEME, primary: "#717171", accent: "#2B4C7E" } }));
    renderApp(<ColourSchemeForm settings={settings} />);
    const primary = screen.getByTestId("colour-primary-input");
    await userEvent.clear(primary);
    await userEvent.type(primary, "#717171");
    const accent = screen.getByTestId("colour-accent-input");
    await userEvent.clear(accent);
    await userEvent.type(accent, "#2b4c7e");
    await userEvent.click(screen.getByTestId("colour-save"));
    await screen.findByTestId("colour-saved");
    expect(calls[0]!.body).toEqual({ theme: { primary: "#717171", accent: "#2B4C7E" } });
  });

  it("shows the server's contrast message beside the field", async () => {
    mockApi(() =>
      problem(422, "contrast_too_low", {
        errors: [{ loc: ["body", "theme", "primary"], message: "Contrast 2.57:1 against the surface colour is below the required 4.5:1.", measured_ratio: 2.57, required_ratio: 4.5 }],
      }),
    );
    renderApp(<ColourSchemeForm settings={settings} />);
    await userEvent.click(screen.getByTestId("preset-navy"));
    await userEvent.click(screen.getByTestId("colour-save"));
    await waitFor(() =>
      expect(screen.getByTestId("colour-primary-ratio").textContent).toBe("Contrast 2.57:1 against the surface colour is below the required 4.5:1."),
    );
  });

  it("Reset asks first, then fills the default without saving", async () => {
    const calls = mockApi(() => ok());
    renderApp(<ColourSchemeForm settings={{ ...settings, theme: { ...DEFAULT_THEME, ...navy } }} />);
    await userEvent.click(screen.getByTestId("colour-reset"));
    await userEvent.click(screen.getByTestId("reset-cancel"));
    expect((screen.getByTestId("colour-primary-input") as HTMLInputElement).value).toBe(navy.primary);
    await userEvent.click(screen.getByTestId("colour-reset"));
    await userEvent.click(screen.getByTestId("reset-confirm"));
    expect((screen.getByTestId("colour-primary-input") as HTMLInputElement).value).toBe(DEFAULT_THEME.primary);
    expect((screen.getByTestId("colour-save") as HTMLButtonElement).disabled).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("ContactRulesForm (UK customers only)", () => {
  const sw = () => screen.getByRole("switch", { name: "UK customers only" }) as HTMLInputElement;
  const saveBtn = () => screen.getByTestId("uk-only-save") as HTMLButtonElement;

  it("is a labelled switch with help text, on by default, Save disabled until changed", () => {
    mockApi(() => ok());
    renderApp(<ContactRulesForm settings={settings} />);
    expect(sw().checked).toBe(true);
    expect(screen.getByTestId("uk-only-help").textContent).toBe(
      "Customer postcodes and phone numbers must be UK ones. Turn off to allow other countries.",
    );
    expect(sw().getAttribute("aria-describedby")).toContain("uk-only-help");
    expect(saveBtn().disabled).toBe(true);
  });

  it("reflects an off setting from the admin settings", () => {
    mockApi(() => ok());
    renderApp(<ContactRulesForm settings={{ ...settings, uk_only_contact_details: false }} />);
    expect(sw().checked).toBe(false);
  });

  it("sends only the boolean and shows Settings saved; toggling back disables Save", async () => {
    const calls = mockApi(() => ok({ uk_only_contact_details: false }));
    renderApp(<ContactRulesForm settings={settings} />);
    await userEvent.click(sw());
    expect(saveBtn().disabled).toBe(false);
    await userEvent.click(saveBtn());
    expect((await screen.findByTestId("uk-only-saved")).textContent).toBe("Settings saved");
    expect(calls[0]).toMatchObject({ method: "PATCH", path: "/api/v1/admin/settings", body: { uk_only_contact_details: false } });
    expect(sw().checked).toBe(false);
  });

  it("shows a 422 message beside the switch", async () => {
    mockApi(() => problem(422, "validation_error", { errors: [{ loc: ["body", "uk_only_contact_details"], message: "Send true or false." }] }));
    renderApp(<ContactRulesForm settings={settings} />);
    await userEvent.click(sw());
    await userEvent.click(saveBtn());
    await waitFor(() => expect(screen.getByTestId("uk-only-error").textContent).toBe("Send true or false."));
    expect(sw().getAttribute("aria-invalid")).toBe("true");
  });

  it("shows a 403 message and keeps the choice", async () => {
    mockApi(() => problem(403, "forbidden"));
    renderApp(<ContactRulesForm settings={settings} />);
    await userEvent.click(sw());
    await userEvent.click(saveBtn());
    expect((await screen.findByTestId("uk-only-forbidden")).textContent).toContain("permission");
    expect(sw().checked).toBe(false);
  });

  it("keeps the choice on a 500 and Try again resubmits", async () => {
    let fail = true;
    const calls = mockApi(() => (fail ? problem(500, "internal_error") : ok({ uk_only_contact_details: false })));
    renderApp(<ContactRulesForm settings={settings} />);
    await userEvent.click(sw());
    await userEvent.click(saveBtn());
    expect((await screen.findByTestId("uk-only-failure")).textContent).toContain("Could not save");
    expect(sw().checked).toBe(false);
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect((await screen.findByTestId("uk-only-saved")).textContent).toBe("Settings saved");
    expect(calls).toHaveLength(2);
  });
});
