import type { AddressUpdate, CustomerEditableValues, CustomerImpact, CustomerRecord, CustomerUpdate } from "../generated";
import type { Flat, FlatValue, MergeAdapter } from "../merge";
import { trimSpaces } from "../text/forbidden";
import { VALIDATORS, type CustomerField } from "./validation";

/** The nine editable fields in display order. The form holds plain strings, exactly as typed. */
export const CUSTOMER_FIELDS: readonly CustomerField[] = [
  "name",
  "contact_name",
  "email",
  "phone",
  "line1",
  "line2",
  "town",
  "county",
  "postcode",
];

export type CustomerFormValues = Record<CustomerField, string>;

export const CUSTOMER_FIELD_LABELS: Record<CustomerField, string> = {
  name: "Name",
  contact_name: "Contact name",
  email: "Email",
  phone: "Phone",
  line1: "Address line 1",
  line2: "Address line 2",
  town: "Town or city",
  county: "County",
  postcode: "Postcode",
};

const ADDRESS_FIELDS: readonly CustomerField[] = ["line1", "line2", "town", "county", "postcode"];
const REQUIRED: readonly CustomerField[] = ["name", "line1", "town", "postcode"];
const isAddressField = (f: CustomerField) => ADDRESS_FIELDS.includes(f);

type Stored = Pick<CustomerRecord, "name" | "contact_name" | "email" | "phone" | "billing_address">;

/** The stored value of one field (null when empty). */
export function storedValue(record: Stored, field: CustomerField): string | null {
  switch (field) {
    case "name":
      return record.name;
    case "contact_name":
      return record.contact_name ?? null;
    case "email":
      return record.email ?? null;
    case "phone":
      return record.phone ?? null;
    default:
      return record.billing_address[field] ?? null;
  }
}

export function formFromCustomer(record: Stored): CustomerFormValues {
  const form = {} as CustomerFormValues;
  for (const f of CUSTOMER_FIELDS) form[f] = storedValue(record, f) ?? "";
  return form;
}

export type CustomerProblems = Partial<Record<CustomerField, string>>;

/** Client-side checks with the same rules and messages as the server (it still has the final say). */
export function validateCustomerForm(form: CustomerFormValues): CustomerProblems {
  const problems: CustomerProblems = {};
  for (const f of CUSTOMER_FIELDS) {
    const r = VALIDATORS[f](form[f]);
    if (!r.ok) problems[f] = r.message;
  }
  return problems;
}

export const hasCustomerProblems = (p: CustomerProblems) => Object.keys(p).length > 0;

/** What the server would store for the typed text; text that fails the rules is compared as typed, trimmed. */
export function normalisedValue(field: CustomerField, raw: string): string | null {
  const r = VALIDATORS[field](raw);
  if (r.ok) return r.value;
  const trimmed = trimSpaces(raw);
  return trimmed === "" ? null : trimmed;
}

/**
 * The PATCH body for what the manager changed, or null when nothing changed. Only changed keys are
 * sent, the address as a partial object. A field the manager did not touch is never sent, even if
 * its stored value would not pass today's rules.
 */
export function buildCustomerUpdate(original: CustomerRecord, form: CustomerFormValues): CustomerUpdate | null {
  const start = formFromCustomer(original);
  const update: CustomerUpdate = { version: original.version };
  const address: AddressUpdate = {};
  let changed = false;
  for (const f of CUSTOMER_FIELDS) {
    if (form[f] === start[f]) continue;
    const next = normalisedValue(f, form[f]);
    if (next === storedValue(original, f)) continue;
    changed = true;
    const target: Record<string, unknown> = isAddressField(f) ? address : update;
    // A blank required field is sent as typed so the server's message names it; validation stops the save first.
    target[f] = next ?? (REQUIRED.includes(f) ? "" : null);
  }
  if (Object.keys(address).length > 0) update.billing_address = address;
  return changed ? update : null;
}

/**
 * True when the server's current values (from a 409) already equal what the update tried to set: how a
 * retry of a request that actually succeeded is recognised.
 */
export function customerCurrentMatchesUpdate(current: CustomerEditableValues | undefined, update: CustomerUpdate): boolean {
  if (!current) return false;
  const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? null) === (b ?? null);
  for (const k of ["name", "contact_name", "email", "phone"] as const) {
    if (k in update && !same(current[k], update[k])) return false;
  }
  for (const [k, v] of Object.entries(update.billing_address ?? {})) {
    if (!same((current.billing_address as Record<string, string | null> | undefined)?.[k], v)) return false;
  }
  return true;
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
}

/**
 * "These details are used on 12 jobs, 12 reports (9 reviewed) and 7 issued invoices." A part with
 * zero is left out; one is singular.
 */
export function impactSentence(impact: CustomerImpact): string {
  const parts: string[] = [];
  if (impact.job_count > 0) parts.push(plural(impact.job_count, "job", "jobs"));
  if (impact.report_count > 0) {
    const reviewed = impact.reviewed_report_count > 0 ? ` (${impact.reviewed_report_count.toLocaleString("en-GB")} reviewed)` : "";
    parts.push(`${plural(impact.report_count, "report", "reports")}${reviewed}`);
  }
  if (impact.issued_invoice_count > 0) parts.push(plural(impact.issued_invoice_count, "issued invoice", "issued invoices"));
  if (parts.length === 0) return "These details are not used on any jobs, reports or invoices yet.";
  const list = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]!}`;
  return `These details are used on ${list}.`;
}

/** The full notice shown in edit mode. */
export function impactNotice(impact: CustomerImpact): string {
  const sentence = impactSentence(impact);
  if (impact.job_count + impact.report_count + impact.issued_invoice_count === 0) return sentence;
  return `${sentence} Changes will show on all of them.${impact.reviewed_report_count > 0 ? " Reviewed reports stay reviewed." : ""}`;
}

const KEY_PREFIX = "billing_address.";
const keyOf = (f: CustomerField) => (isAddressField(f) ? `${KEY_PREFIX}${f}` : f);
const fieldOf = (key: string) => (key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : key) as CustomerField;

/** Merge adapter for the customer form (T-002o). Keys: `name`, `email`, ..., `billing_address.postcode`. */
export const customerMergeAdapter: MergeAdapter<CustomerFormValues> = {
  flatten(form) {
    const flat: Flat = {};
    for (const f of CUSTOMER_FIELDS) flat[keyOf(f)] = form[f];
    return flat;
  },
  unflatten(flat) {
    const form = {} as CustomerFormValues;
    for (const f of CUSTOMER_FIELDS) form[f] = String(flat[keyOf(f)] ?? "");
    return form;
  },
  normalise(key: string, value: FlatValue) {
    return normalisedValue(fieldOf(key), String(value));
  },
  label(key) {
    return CUSTOMER_FIELD_LABELS[fieldOf(key)];
  },
};
