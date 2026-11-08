import type { Dashboard, ReportDetail, ReportSummary } from "@jobproof/shared";

export const SARAH = { id: "u-sarah", name: "Sarah Whitfield" };
export const PRIYA = { id: "u-priya", name: "Priya Nair" };

export function summary(n: number, over: Partial<ReportSummary> = {}): ReportSummary {
  return {
    id: `r${n}`,
    job_reference: `JP-10${n}`,
    customer: { id: `c${n}`, name: `Customer ${n}` },
    site_address: { line1: `${n} High Street`, town: "Leeds", postcode: "LS1 1AA" },
    painter: { id: "p1", name: "Dan Hughes" },
    completed_on: "2026-10-10",
    submitted_at: `2026-10-1${n}T10:00:00Z`,
    photo_count: 4,
    review_status: "awaiting_review",
    billing_status: "not_invoiced",
    ...over,
  } as ReportSummary;
}

export function dashboard(queue: ReportSummary[], awaiting = queue.length): Dashboard {
  return {
    as_of: "2026-10-15T10:42:00Z",
    period_start: "2026-10-01",
    period_end: "2026-10-31",
    reports_awaiting_review: awaiting,
    jobs_completed_this_month: 3,
    invoiced_this_month_pence: 0,
    outstanding_pence: 0,
    overdue_invoice_count: 0,
    currency: "GBP",
    review_queue: queue,
    recent_reports: [],
  } as Dashboard;
}

export function report(over: Partial<ReportDetail> = {}): ReportDetail {
  return {
    id: "r1",
    review_status: "awaiting_review",
    submitted_at: "2026-10-12T09:00:00Z",
    reviewed_at: null,
    reviewed_by: null,
    version: 1,
    last_changed_at: null,
    last_changed_by: null,
    painter_notes: "Two coats applied.",
    manager_notes: null,
    billing_status: "not_invoiced",
    job: { reference: "JP-1042", title: "Hall repaint" },
    customer: { name: "Customer" },
    painter: { id: "p1", name: "Dan Hughes" },
    checklist: [
      { id: "c1", label: "Skirting boards gloss", done: false, note: null },
      { id: "c2", label: "Ceilings", done: true, note: "Done twice" },
    ],
    photos: [],
    quote: null,
    invoice: null,
    payments: [],
    ...over,
  } as unknown as ReportDetail;
}
