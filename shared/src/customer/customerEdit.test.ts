import { describe, expect, it } from "vitest";
import type { CustomerRecord } from "../generated";
import { ApiError } from "../api/errors";
import { parseCustomerConflict } from "../conflict";
import { describeEvent } from "../history";
import type { AuditEvent } from "../generated";
import {
  buildCustomerUpdate,
  customerCurrentMatchesUpdate,
  formFromCustomer,
  impactNotice,
  impactSentence,
  validateCustomerForm,
} from "./customerEdit";

const customer = (over: Partial<CustomerRecord> = {}): CustomerRecord => ({
  id: "c1",
  name: "Seaview Lettings Ltd",
  customer_type: "landlord",
  contact_name: "Marcus Ellery",
  email: "marcus@seaview.example.co.uk",
  phone: "07700 900201",
  billing_address: { line1: "Unit 4", line2: "Welsh Back Court", town: "Bristol", county: "City of Bristol", postcode: "BS1 4SB" },
  version: 3,
  last_changed_at: null,
  last_changed_by: null,
  impact: { job_count: 12, report_count: 12, reviewed_report_count: 9, issued_invoice_count: 7 },
  ...over,
});

describe("buildCustomerUpdate", () => {
  it("is null when nothing changed", () => {
    expect(buildCustomerUpdate(customer(), formFromCustomer(customer()))).toBeNull();
  });

  it("sends only changed keys with the loaded version, and a partial address", () => {
    const form = { ...formFromCustomer(customer()), phone: "0117 496 0123", postcode: "bs1 4sa" };
    expect(buildCustomerUpdate(customer(), form)).toEqual({
      version: 3,
      phone: "0117 496 0123",
      billing_address: { postcode: "BS1 4SA" },
    });
  });

  it("a value that normalises to the stored one is a no-op", () => {
    const form = { ...formFromCustomer(customer()), postcode: "bs14sb", phone: "07700  900201", email: " marcus@seaview.example.co.uk " };
    expect(buildCustomerUpdate(customer(), form)).toBeNull();
  });

  it("clearing an optional field sends null; clearing a required one is still sent (and refused by validation)", () => {
    const form = { ...formFromCustomer(customer()), email: "  ", line2: "", town: "" };
    expect(buildCustomerUpdate(customer(), form)).toEqual({
      version: 3,
      email: null,
      billing_address: { line2: null, town: "" },
    });
    expect(validateCustomerForm(form).town).toBe("Enter a town or city.");
  });

  it("never sends a field the manager did not touch, even if its stored value is invalid today", () => {
    const old = customer({ phone: "ring me" });
    const form = { ...formFromCustomer(old), name: "New name" };
    expect(buildCustomerUpdate(old, form)).toEqual({ version: 3, name: "New name" });
  });

  it("shows the empty fields as empty strings", () => {
    const form = formFromCustomer(customer({ contact_name: null, email: null }));
    expect(form.contact_name).toBe("");
    expect(form.email).toBe("");
  });
});

describe("customerCurrentMatchesUpdate", () => {
  it("is true only when every sent field already holds the value", () => {
    const update = { version: 1, phone: "0117 496 0123", billing_address: { line2: null } };
    expect(customerCurrentMatchesUpdate({ phone: "0117 496 0123", billing_address: { line2: null } }, update)).toBe(true);
    expect(customerCurrentMatchesUpdate({ phone: "other", billing_address: { line2: null } }, update)).toBe(false);
    expect(customerCurrentMatchesUpdate(undefined, update)).toBe(false);
  });
});

describe("impactSentence", () => {
  const impact = (job_count: number, report_count: number, reviewed_report_count: number, issued_invoice_count: number) => ({
    job_count,
    report_count,
    reviewed_report_count,
    issued_invoice_count,
  });
  it("lists the parts", () => {
    expect(impactSentence(impact(12, 12, 9, 7))).toBe("These details are used on 12 jobs, 12 reports (9 reviewed) and 7 issued invoices.");
  });
  it("uses singular for one", () => {
    expect(impactSentence(impact(1, 1, 1, 1))).toBe("These details are used on 1 job, 1 report (1 reviewed) and 1 issued invoice.");
  });
  it("leaves out zero parts", () => {
    expect(impactSentence(impact(3, 3, 0, 0))).toBe("These details are used on 3 jobs and 3 reports.");
    expect(impactSentence(impact(2, 0, 0, 0))).toBe("These details are used on 2 jobs.");
    expect(impactSentence(impact(0, 0, 0, 0))).toBe("These details are not used on any jobs, reports or invoices yet.");
  });
  it("the notice adds the reviewed reassurance only when something is reviewed", () => {
    expect(impactNotice(impact(12, 12, 9, 7))).toBe(
      "These details are used on 12 jobs, 12 reports (9 reviewed) and 7 issued invoices. Changes will show on all of them. Reviewed reports stay reviewed.",
    );
    expect(impactNotice(impact(1, 1, 0, 0))).toBe("These details are used on 1 job and 1 report. Changes will show on all of them.");
  });
});

describe("describeEvent for customer.edited", () => {
  it("names the labels, marks it as a customer event and keeps the customer id", () => {
    const event: AuditEvent = {
      id: "e1",
      occurred_at: "2026-10-15T10:42:00Z",
      actor: { id: "u", name: "Priya Nair" },
      action: "customer.edited",
      customer_id: "c1",
      changes: [
        { field: "customer_phone", item_id: null, item_label: null, old_value: "07700 900201", new_value: "0117 496 0123" },
        { field: "customer_billing_postcode", item_id: null, item_label: null, old_value: "BS1 4SB", new_value: null },
      ],
    };
    const d = describeEvent(event);
    expect(d.sentence).toBe("Priya Nair changed customer details: Phone, Postcode");
    expect(d.isCustomerEvent).toBe(true);
    expect(d.customerId).toBe("c1");
    expect(d.changes).toEqual([
      { label: "Phone", old: "07700 900201", new: "0117 496 0123" },
      { label: "Postcode", old: "BS1 4SB", new: "(empty)" },
    ]);
  });
});

describe("parseCustomerConflict", () => {
  const err = (code: string, extra: Record<string, unknown>, status = 409) =>
    new ApiError({ status, code, title: "Conflict", problem: { code, ...extra } });
  it("is stale with the current values, never already_reviewed", () => {
    const c = parseCustomerConflict(
      err("version_conflict", {
        current_version: 4,
        last_changed_by: { id: "u1", name: "Sarah Whitfield" },
        last_changed_at: "2026-10-15T10:40:00Z",
        current: { email: "a@b.co.uk" },
      }),
    );
    expect(c).toMatchObject({ kind: "stale", currentVersion: 4, current: { email: "a@b.co.uk" } });
    expect(parseCustomerConflict(err("other", {}))).toBeNull();
    expect(parseCustomerConflict(err("version_conflict", {}, 500))).toBeNull();
  });
});
