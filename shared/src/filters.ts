import type { BillingStatus, InvoiceStatus, ReviewStatus } from "./generated";

export const REVIEW_STATUSES: readonly ReviewStatus[] = ["awaiting_review", "reviewed"];
export const BILLING_STATUSES: readonly BillingStatus[] = [
  "not_invoiced",
  "draft",
  "sent",
  "part_paid",
  "overdue",
  "paid",
  "void",
];
export const INVOICE_STATUSES: readonly InvoiceStatus[] = [
  "draft",
  "sent",
  "part_paid",
  "overdue",
  "paid",
  "void",
];

export const PAGE_SIZE = 20;
export const MAX_SEARCH_LENGTH = 100;

export interface ReportFilters {
  page: number;
  q?: string;
  review_status?: ReviewStatus;
  billing_status?: BillingStatus;
  painter_id?: string;
  date_from?: string;
  date_to?: string;
}

export interface InvoiceFilters {
  page: number;
  status?: InvoiceStatus;
}

/** Anything with URLSearchParams.get, so web and mobile can both use it. */
export interface ParamSource {
  get(name: string): string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function oneOf<T extends string>(allowed: readonly T[], value: string | null): T | undefined {
  return allowed.find((a) => a === value);
}

function parsePage(value: string | null): number {
  if (value === null || !/^[0-9]{1,6}$/.test(value)) return 1;
  const n = Number(value);
  return n >= 1 ? n : 1;
}

function parseDate(value: string | null): string | undefined {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? undefined : value;
}

function parseQuery(value: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > MAX_SEARCH_LENGTH) return undefined;
  // Control characters (NUL, tab, newline...) are rejected by the API with a 422.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return undefined;
  return trimmed;
}

function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

export function parseReportFilters(params: ParamSource): ReportFilters {
  const date_from = parseDate(params.get("date_from"));
  let date_to = parseDate(params.get("date_to"));
  if (date_from && date_to && date_to < date_from) date_to = undefined;
  const painter = params.get("painter_id");
  return compact({
    page: parsePage(params.get("page")),
    q: parseQuery(params.get("q")),
    review_status: oneOf(REVIEW_STATUSES, params.get("review_status")),
    billing_status: oneOf(BILLING_STATUSES, params.get("billing_status")),
    painter_id: painter && UUID.test(painter) ? painter.toLowerCase() : undefined,
    date_from,
    date_to,
  });
}

export function parseInvoiceFilters(params: ParamSource): InvoiceFilters {
  return compact({
    page: parsePage(params.get("page")),
    status: oneOf(INVOICE_STATUSES, params.get("status")),
  });
}

/** Query string for the browser URL: page 1 and empty values are left out. */
export function serialiseFilters(filters: ReportFilters | InvoiceFilters): URLSearchParams {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === "") continue;
    if (key === "page" && value === 1) continue;
    out.set(key, String(value));
  }
  return out;
}

/** True when any filter other than the page is set. */
export function hasActiveFilters(filters: ReportFilters | InvoiceFilters): boolean {
  return Object.entries(filters).some(([k, v]) => k !== "page" && v !== undefined);
}
