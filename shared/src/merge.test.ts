import { describe, expect, it } from "vitest";
import { buildReportUpdate, formFromReport, reportMergeAdapter, type FormValues } from "./reportEdit";
import { customerMergeAdapter, formFromCustomer, buildCustomerUpdate } from "./customer/customerEdit";
import { mergeOnTop, resolve } from "./merge";
import type { CustomerRecord, ReportDetail } from "./generated";

const report = (over: Partial<ReportDetail> = {}): ReportDetail =>
  ({
    id: "r1",
    version: 3,
    painter_notes: "Two coats.",
    manager_notes: null,
    checklist: [
      { id: "c1", label: "Skirting boards gloss", done: false, note: null },
      { id: "c2", label: "Ceilings", done: true, note: "Done twice" },
    ],
    ...over,
  }) as unknown as ReportDetail;

const adapter = reportMergeAdapter(report().checklist);
const form = (r: ReportDetail, over: Partial<FormValues> = {}): FormValues => ({ ...formFromReport(r), ...over });
const withItem = (f: FormValues, id: string, patch: Partial<FormValues["checklist"][string]>): FormValues => ({
  ...f,
  checklist: { ...f.checklist, [id]: { ...f.checklist[id]!, ...patch } },
});

describe("mergeOnTop rules (report)", () => {
  const base = report();

  it("rule 1: a field the manager did not change takes the latest value", () => {
    const theirs = report({ painter_notes: "Sarah's text", version: 4 });
    const r = mergeOnTop(adapter, form(base), form(base, { manager_notes: "Mine" }), form(theirs));
    expect(r.form.painter_notes).toBe("Sarah's text");
    expect(r.clashes).toEqual([]);
  });

  it("rule 2: a field only the manager changed is re-applied", () => {
    const theirs = report({ painter_notes: "Sarah's text", version: 4 });
    const r = mergeOnTop(adapter, form(base), form(base, { manager_notes: "Mine" }), form(theirs));
    expect(r.form.manager_notes).toBe("Mine");
    expect(r.reapplied).toEqual(["manager_notes"]);
  });

  it("rule 3: the same change by both is not a clash and is not sent again", () => {
    const base0 = report();
    const theirs = report({
      version: 4,
      checklist: [{ id: "c1", label: "Skirting boards gloss", done: true, note: null }, base0.checklist[1]!],
    });
    const mine = withItem(form(base0), "c1", { done: true });
    const r = mergeOnTop(adapter, form(base0), mine, form(theirs));
    expect(r.clashes).toEqual([]);
    expect(r.reapplied).toEqual([]);
    expect(buildReportUpdate(theirs, r.form)).toBeNull();
  });

  it("rule 4: both changed differently is a clash that holds the latest value until resolved", () => {
    const theirs = report({
      version: 4,
      checklist: [{ id: "c1", label: "Skirting boards gloss", done: false, note: "Second coat 17 Oct" }, report().checklist[1]!],
    });
    const mine = withItem(form(base), "c1", { note: "Done 16 Oct" });
    const r = mergeOnTop(adapter, form(base), mine, form(theirs));
    expect(r.clashes).toEqual([
      { key: "checklist:c1:note", label: "Checklist: Skirting boards gloss (note)", mine: "Done 16 Oct", theirs: "Second coat 17 Oct" },
    ]);
    expect(r.form.checklist.c1!.note).toBe("Second coat 17 Oct");
  });

  it("compares normalised values: blank equals null, so it is never a clash", () => {
    const theirs = report({ version: 4, manager_notes: "   " });
    const r = mergeOnTop(adapter, form(base), form(base, { manager_notes: "" }), form(theirs));
    expect(r.clashes).toEqual([]);
    expect(r.reapplied).toEqual([]);
  });

  it("orders clashes in display order", () => {
    const theirs = report({
      version: 4,
      painter_notes: "T",
      manager_notes: "T2",
      checklist: [{ id: "c1", label: "Skirting boards gloss", done: true, note: "y" }, report().checklist[1]!],
    });
    const mine = withItem(form(base, { painter_notes: "M", manager_notes: "M2" }), "c1", { done: false, note: "x" });
    const r = mergeOnTop(adapter, form(base), mine, form(theirs));
    expect(r.clashes.map((c) => c.key)).toEqual(["painter_notes", "manager_notes", "checklist:c1:note"]);
  });
});

describe("resolve", () => {
  const base = report();
  const theirs = report({ version: 4, painter_notes: "T", manager_notes: "T2" });
  const mine = form(base, { painter_notes: "M", manager_notes: "M2" });
  const r = mergeOnTop(adapter, form(base), mine, form(theirs));

  it("all theirs equals the latest, so there is nothing to save", () => {
    const out = resolve(adapter, r, { painter_notes: "theirs", manager_notes: "theirs" });
    expect(out).toEqual(form(theirs));
    expect(buildReportUpdate(theirs, out)).toBeNull();
  });
  it("all mine keeps the manager's values", () => {
    const out = resolve(adapter, r, { painter_notes: "mine", manager_notes: "mine" });
    expect(out.painter_notes).toBe("M");
    expect(buildReportUpdate(theirs, out)).toEqual({ version: 4, painter_notes: "M", manager_notes: "M2" });
  });
  it("mixed, and an unchosen clash keeps the latest value", () => {
    const out = resolve(adapter, r, { painter_notes: "mine" });
    expect(out.painter_notes).toBe("M");
    expect(out.manager_notes).toBe("T2");
  });
  it("is idempotent: merging the same latest twice gives the same form", () => {
    const once = mergeOnTop(adapter, form(base), mine, form(theirs));
    const twice = mergeOnTop(adapter, form(theirs), once.form, form(theirs));
    expect(twice.form).toEqual(once.form);
    expect(twice.clashes).toEqual([]);
  });
});

describe("mergeOnTop (customer)", () => {
  const rec = (over: Partial<CustomerRecord> = {}): CustomerRecord => ({
    id: "c",
    name: "Harbourside Lettings Ltd",
    customer_type: "landlord",
    contact_name: "Marcus Ellery",
    email: "a@b.co.uk",
    phone: "07700 900201",
    billing_address: { line1: "Unit 4", line2: null, town: "Bristol", county: null, postcode: "BS1 4SB" },
    version: 2,
    last_changed_at: null,
    last_changed_by: null,
    impact: { job_count: 1, report_count: 1, reviewed_report_count: 0, issued_invoice_count: 0 },
    ...over,
  });

  it("phone by the other manager and email by this one merge without a question", () => {
    const base = rec();
    const theirs = rec({ version: 3, phone: "0117 496 0123" });
    const mine = { ...formFromCustomer(base), email: "new@b.co.uk" };
    const r = mergeOnTop(customerMergeAdapter, formFromCustomer(base), mine, formFromCustomer(theirs));
    expect(r.form.phone).toBe("0117 496 0123");
    expect(r.form.email).toBe("new@b.co.uk");
    expect(r.reapplied).toEqual(["email"]);
    expect(buildCustomerUpdate(theirs, r.form)).toEqual({ version: 3, email: "new@b.co.uk" });
  });

  it("the same field changed by both is a clash with the field's label", () => {
    const base = rec();
    const theirs = rec({ version: 3, email: "sarah@b.co.uk" });
    const mine = { ...formFromCustomer(base), email: "priya@b.co.uk" };
    const r = mergeOnTop(customerMergeAdapter, formFromCustomer(base), mine, formFromCustomer(theirs));
    expect(r.clashes).toEqual([{ key: "email", label: "Email", mine: "priya@b.co.uk", theirs: "sarah@b.co.uk" }]);
  });

  it("postcode case and spacing never clash", () => {
    const base = rec();
    const theirs = rec({ version: 3, billing_address: { ...base.billing_address, postcode: "BS1 4SA" } });
    const mine = { ...formFromCustomer(base), postcode: "bs1 4sa" };
    const r = mergeOnTop(customerMergeAdapter, formFromCustomer(base), mine, formFromCustomer(theirs));
    expect(r.clashes).toEqual([]);
    expect(buildCustomerUpdate(theirs, r.form)).toBeNull();
  });

  it("invalid typed text is compared as typed, so it is re-applied and still validated later", () => {
    const base = rec();
    const theirs = rec({ version: 3, name: "Renamed Ltd" });
    const mine = { ...formFromCustomer(base), phone: "12345" };
    const r = mergeOnTop(customerMergeAdapter, formFromCustomer(base), mine, formFromCustomer(theirs));
    expect(r.form.phone).toBe("12345");
    expect(r.reapplied).toEqual(["phone"]);
  });
});
