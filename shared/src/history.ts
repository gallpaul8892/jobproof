import type { AuditChange, AuditEvent, AuditField } from "./generated";
import { formatDateTime } from "./format/dates";
import { WORDING } from "./format/labels";

const FIELD_LABELS: Record<AuditField, string> = {
  review_status: "Review status",
  reviewed_by: "Reviewed by",
  reviewed_at: "Reviewed at",
  painter_notes: WORDING.fieldWorkerNotes,
  manager_notes: "Manager notes",
  checklist_done: "Checklist",
  checklist_note: "Checklist note",
  company_name: "Company name",
  theme_primary: "Primary colour",
  theme_accent: "Accent colour",
  uk_only_contact_details: "UK-only contact details",
  customer_name: "Customer name",
  customer_contact_name: "Contact name",
  customer_email: "Email",
  customer_phone: "Phone",
  customer_billing_line1: "Billing address line 1",
  customer_billing_line2: "Billing address line 2",
  customer_billing_town: "Town",
  customer_billing_county: "County",
  customer_billing_postcode: "Postcode",
};

export const REVIEW_STATUS_VALUES: Record<string, string> = {
  awaiting_review: "Awaiting review",
  reviewed: "Reviewed",
};

export interface DescribedChange {
  label: string;
  old: string;
  new: string;
}

export interface DescribedEvent {
  sentence: string;
  changes: DescribedChange[];
  /** A customer.edited event: shown on a report's History with a tag and a link to the customer. */
  isCustomerEvent?: boolean;
  customerId?: string;
}

export const EMPTY_VALUE = "(empty)";

/** Field label; checklist fields name the item: "Checklist: Skirting boards gloss". */
export function changeLabel(change: Pick<AuditChange, "field" | "item_label">): string {
  const base = FIELD_LABELS[change.field] ?? change.field;
  return change.item_label ? `${base}: ${change.item_label}` : base;
}

function show(change: AuditChange, value: AuditChange["old_value"]): string {
  if (value === null || value === undefined || value === "") return EMPTY_VALUE;
  if (typeof value === "boolean") {
    if (change.field === "uk_only_contact_details") return value ? "On" : "Off";
    return value ? "Done" : "Not done";
  }
  if (change.field === "review_status") return REVIEW_STATUS_VALUES[value] ?? value;
  if (change.field === "reviewed_at") return formatDateTime(value);
  return value;
}

/** Labels in the order first seen, once each (a checklist item that changed twice reads once). */
function sentenceLabels(changes: AuditChange[]): string[] {
  const seen = new Set<string>();
  for (const c of changes) {
    seen.add(c.field === "checklist_note" && c.item_label ? `Checklist: ${c.item_label}` : changeLabel(c));
  }
  return [...seen];
}

function valueOf(changes: AuditChange[], field: AuditField): string | null {
  const v = changes.find((c) => c.field === field)?.old_value;
  return typeof v === "string" ? v : null;
}

export function describeEvent(event: AuditEvent): DescribedEvent {
  const actor = event.actor.name;
  switch (event.action) {
    case "report.reviewed":
      return { sentence: `${actor} marked the report as reviewed`, changes: [] };
    case "report.reopened": {
      const by = valueOf(event.changes, "reviewed_by");
      const at = valueOf(event.changes, "reviewed_at");
      const previous = by ? ` (previously reviewed by ${by}${at ? ` on ${formatDateTime(at)}` : ""})` : "";
      return { sentence: `Report returned to Awaiting review${previous}`, changes: [] };
    }
    case "report.edited":
    case "settings.changed":
      return {
        sentence: `${actor} changed ${sentenceLabels(event.changes).join(", ")}`,
        changes: event.changes.map((c) => ({
          label: c.field === "checklist_note" && c.item_label ? `Checklist note: ${c.item_label}` : changeLabel(c),
          old: show(c, c.old_value),
          new: show(c, c.new_value),
        })),
      };
    case "customer.edited":
      return {
        sentence: `${actor} changed customer details: ${sentenceLabels(event.changes).join(", ")}`,
        changes: event.changes.map((c) => ({ label: changeLabel(c), old: show(c, c.old_value), new: show(c, c.new_value) })),
        isCustomerEvent: true,
        customerId: event.customer_id ?? undefined,
      };
    default:
      return { sentence: `${actor} made a change`, changes: [] };
  }
}

/** Cuts at `max` code points. */
export function truncate(value: string, max = 200): { short: string; isTruncated: boolean } {
  const chars = Array.from(value);
  if (chars.length <= max) return { short: value, isTruncated: false };
  return { short: chars.slice(0, max).join("") + "…", isTruncated: true };
}
