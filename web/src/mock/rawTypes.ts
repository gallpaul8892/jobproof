import type {
  CustomerType,
  DemoAccount,
  InvoiceStatus,
  JobStatus,
  JobType,
  PhotoStage,
  ReviewStatus,
  Theme,
} from "@jobproof/shared";

/**
 * The shape of mockData.json, written by scripts/export-mock-data.py from the backend seed
 * (flat rows, like the database tables). The mock API derives every response from these.
 */
export interface RawUser {
  id: string;
  email: string;
  full_name: string;
  role: "manager" | "painter" | "admin";
  is_active: boolean;
}

export interface RawCustomer {
  id: string;
  customer_type: CustomerType;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  billing_line1: string;
  billing_line2: string | null;
  billing_town: string;
  billing_county: string | null;
  billing_postcode: string;
  payment_terms_days: number;
}

export interface RawJob {
  id: string;
  reference: string;
  customer_id: string;
  painter_id: string | null;
  job_type: JobType;
  title: string;
  status: JobStatus;
  site_line1: string;
  site_line2: string | null;
  site_town: string;
  site_county: string | null;
  site_postcode: string;
  notes: string | null;
  scheduled_start: string;
  completed_on: string | null;
}

export interface RawQuote {
  id: string;
  job_id: string;
  reference: string;
  status: "draft" | "sent" | "accepted" | "declined" | "expired";
  total_pence: number;
  deposit_pence: number;
  issued_on: string;
  accepted_on: string | null;
}

export interface RawReport {
  id: string;
  job_id: string;
  painter_id: string;
  submitted_at: string;
  painter_notes: string | null;
  manager_notes: string | null;
  review_status: ReviewStatus;
  reviewed_at: string | null;
  reviewed_by_id: string | null;
}

export interface RawChecklistItem {
  id: string;
  report_id: string;
  position: number;
  label: string;
  done: boolean;
  note: string | null;
  cannot_do: boolean;
}

export interface RawPhoto {
  id: string;
  report_id: string;
  stage: PhotoStage;
  position: number;
  caption: string;
  taken_at: string;
  width: number;
  height: number;
}

export interface RawInvoice {
  id: string;
  job_id: string;
  customer_id: string;
  number: string;
  state: "draft" | "issued" | "void";
  subtotal_pence: number;
  vat_pence: number;
  deposit_applied_pence: number;
  total_pence: number;
  issue_date: string | null;
  due_date: string | null;
}

export interface RawPayment {
  id: string;
  kind: "deposit" | "invoice";
  quote_id: string | null;
  invoice_id: string | null;
  amount_pence: number;
  method: "card" | "bank_transfer" | "cash";
  received_at: string;
}

export interface MockData {
  /** The demo's fixed "today" (YYYY-MM-DD). */
  anchor: string;
  settings: { company_name: string; theme: Theme; uk_only_contact_details: boolean };
  demo_accounts: DemoAccount[];
  users: RawUser[];
  customers: RawCustomer[];
  jobs: RawJob[];
  quotes: RawQuote[];
  reports: RawReport[];
  checklist_items: RawChecklistItem[];
  photos: RawPhoto[];
  invoices: RawInvoice[];
  payments: RawPayment[];
}

export type { InvoiceStatus };
