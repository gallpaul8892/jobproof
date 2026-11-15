import {
  REQUIRED_RATIO,
  VALIDATORS,
  reportRatio,
  validateCompanyName,
  meetsAA,
  weakestContrast,
  type AdminSettings,
  type Address,
  type AuditChange,
  type AuditEvent,
  type AuditHistory,
  type BillingStatus,
  type ChecklistItem,
  type CustomerDetail,
  type CustomerRecord,
  type Dashboard,
  type DemoAccount,
  type InvoicePage,
  type InvoiceRow,
  type InvoiceStatus,
  type InvoiceSummary,
  type Payment,
  type PersonRef,
  type QuoteSummary,
  type ReportDetail,
  type ReportPage,
  type ReportPhoto,
  type ReportSummary,
  type User,
  type Branding,
  type CustomerField,
} from "@jobproof/shared";
import type { MockData, RawCustomer, RawInvoice, RawJob, RawReport } from "./rawTypes";
import { placeholderDataUri } from "./photoSvg";

/**
 * The whole "backend" of the Pages demo: the API's behaviour over the exported seed data, held in
 * memory. It mirrors backend/app/services (filters, sorting, derived billing status, optimistic
 * concurrency, audit trail). Every return type comes from the generated client types, so a
 * change to api/openapi.yaml that these shapes no longer fit fails the type-check.
 * State lives only in memory: a page reload starts again from the seed.
 */

export interface FieldIssue {
  loc: (string | number)[];
  message: string;
  measured_ratio?: number;
  required_ratio?: number;
}

/** An RFC 9457 problem answer, thrown by the mock and turned into a Response by the handler. */
export class MockProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail: string,
    readonly extensions: Record<string, unknown> = {},
    readonly errors?: FieldIssue[],
  ) {
    super(detail);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const HISTORY_LIMIT = 100;
// Control characters other than the ones notes may hold are fine; only NUL and lone surrogates cannot be stored.
// eslint-disable-next-line no-control-regex
const NUL_OR_SURROGATE = /[\u0000\ud800-\udfff]/u;

export const NOT_FOUND = (what: string) => new MockProblem(404, "not_found", `${what} not found.`);
const validation = (errors: FieldIssue[]) =>
  new MockProblem(422, "validation_error", "Request validation failed.", {}, errors);

let idCounter = 0;
function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  idCounter += 1;
  return `00000000-0000-4000-8000-${String(idCounter).padStart(12, "0")}`;
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
const emptyToNull = (v: string | null | undefined) => (v === null || v === undefined || v.trim() === "" ? null : v);

interface StoredEvent {
  seq: number;
  report_id: string | null;
  customer_id: string | null;
  settings: boolean;
  event: AuditEvent;
}

interface ReportState extends RawReport {
  version: number;
  last_changed_at: string | null;
  last_changed_by_id: string | null;
}

interface CustomerState extends RawCustomer {
  version: number;
  last_changed_at: string | null;
  last_changed_by_id: string | null;
}

export interface ReportFilters {
  review_status?: string;
  billing_status?: string;
  painter_id?: string;
  customer_id?: string;
  date_from?: string;
  date_to?: string;
  q?: string;
  sort?: string;
}

export interface MockBackendOptions {
  /** Wall clock for the times written by edits. Default: the real clock. */
  now?: () => Date;
}

type ChecklistState = { id: string; report_id: string; position: number; label: string; done: boolean; note: string | null; cannot_do: boolean };

export function createMockBackend(seed: MockData, options: MockBackendOptions = {}) {
  const clock = options.now ?? (() => new Date());
  const data = structuredClone(seed);
  const today = data.anchor;

  const users = new Map(data.users.map((u) => [u.id, u]));
  const customers = new Map<string, CustomerState>(
    data.customers.map((c) => [c.id, { ...c, version: 1, last_changed_at: null, last_changed_by_id: null }]),
  );
  const jobs = new Map(data.jobs.map((j) => [j.id, j]));
  const reports = new Map<string, ReportState>(
    data.reports.map((r) => [r.id, { ...r, version: 1, last_changed_at: null, last_changed_by_id: null }]),
  );
  const checklist = new Map<string, ChecklistState[]>();
  for (const item of [...data.checklist_items].sort((a, b) => a.position - b.position)) {
    const list = checklist.get(item.report_id) ?? [];
    list.push({ ...item });
    checklist.set(item.report_id, list);
  }
  const photos = new Map<string, typeof data.photos>();
  for (const p of data.photos) photos.set(p.report_id, [...(photos.get(p.report_id) ?? []), p]);
  const reportByJob = new Map(data.reports.map((r) => [r.job_id, r.id]));

  const settings = {
    company_name: data.settings.company_name,
    theme: { ...data.settings.theme },
    uk_only_contact_details: data.settings.uk_only_contact_details,
    updated_at: null as string | null,
    updated_by: null as PersonRef | null,
  };
  const events: StoredEvent[] = [];

  const person = (id: string | null): PersonRef | null => {
    if (id === null) return null;
    const u = users.get(id);
    return u ? { id, name: u.full_name } : null;
  };
  const toUser = (id: string): User => {
    const u = users.get(id)!;
    return { id: u.id, email: u.email, full_name: u.full_name, role: u.role };
  };

  function record(
    actor: User,
    action: AuditEvent["action"],
    changes: AuditChange[],
    scope: { report_id?: string; customer_id?: string; settings?: boolean },
    when: string,
  ) {
    events.push({
      seq: events.length + 1,
      report_id: scope.report_id ?? null,
      customer_id: scope.customer_id ?? null,
      settings: scope.settings ?? false,
      event: {
        id: newId(),
        occurred_at: when,
        actor: { id: actor.id, name: actor.full_name },
        action,
        ...(scope.customer_id ? { customer_id: scope.customer_id } : {}),
        changes,
      },
    });
  }

  function history(match: (e: StoredEvent) => boolean): AuditHistory {
    const all = events.filter(match).sort((a, b) => b.seq - a.seq);
    return { items: all.slice(0, HISTORY_LIMIT).map((e) => e.event), total: all.length };
  }

  // ---- billing (backend/app/services/billing.py) ----

  const invoicesByJob = new Map<string, RawInvoice[]>();
  for (const inv of data.invoices) invoicesByJob.set(inv.job_id, [...(invoicesByJob.get(inv.job_id) ?? []), inv]);
  const quotesByJob = new Map<string, typeof data.quotes>();
  for (const q of data.quotes) quotesByJob.set(q.job_id, [...(quotesByJob.get(q.job_id) ?? []), q]);

  const paidOn = (inv: RawInvoice) =>
    data.payments.filter((p) => p.kind === "invoice" && p.invoice_id === inv.id).reduce((s, p) => s + p.amount_pence, 0);
  const balanceOf = (total: number, paid: number) => Math.max(total - paid, 0);

  function invoiceStatus(inv: RawInvoice): InvoiceStatus {
    if (inv.state === "void") return "void";
    if (inv.state === "draft") return "draft";
    const paid = paidOn(inv);
    if (balanceOf(inv.total_pence, paid) === 0) return "paid";
    if (inv.due_date !== null && inv.due_date < today) return "overdue";
    return paid > 0 ? "part_paid" : "sent";
  }

  /** The job's invoice: its live one, else its latest void one. */
  function chosenInvoice(jobId: string): RawInvoice | null {
    const list = [...(invoicesByJob.get(jobId) ?? [])];
    list.sort((a, b) => {
      const av = a.state === "void" ? 1 : 0;
      const bv = b.state === "void" ? 1 : 0;
      if (av !== bv) return av - bv;
      // issue_date descending, nulls last, then number descending
      if (a.issue_date !== b.issue_date) {
        if (a.issue_date === null) return 1;
        if (b.issue_date === null) return -1;
        return a.issue_date < b.issue_date ? 1 : -1;
      }
      return a.number < b.number ? 1 : a.number > b.number ? -1 : 0;
    });
    return list[0] ?? null;
  }

  function billingStatusOf(jobId: string): BillingStatus {
    const inv = chosenInvoice(jobId);
    return inv === null ? "not_invoiced" : invoiceStatus(inv);
  }

  /** The job's quote: its latest accepted one, else its latest issued one. */
  function chosenQuote(jobId: string) {
    const list = [...(quotesByJob.get(jobId) ?? [])];
    list.sort((a, b) => {
      const aa = a.status === "accepted" ? 0 : 1;
      const ba = b.status === "accepted" ? 0 : 1;
      if (aa !== ba) return aa - ba;
      if (a.issued_on !== b.issued_on) return a.issued_on < b.issued_on ? 1 : -1;
      return a.reference < b.reference ? 1 : a.reference > b.reference ? -1 : 0;
    });
    return list[0] ?? null;
  }

  // ---- reports ----

  const address = (prefix: "site" | "billing", o: RawJob | RawCustomer): Address => {
    const r = o as unknown as Record<string, string | null>;
    return {
      line1: r[`${prefix}_line1`] as string,
      line2: r[`${prefix}_line2`] ?? null,
      town: r[`${prefix}_town`] as string,
      county: r[`${prefix}_county`] ?? null,
      postcode: r[`${prefix}_postcode`] as string,
    };
  };

  function summary(report: ReportState): ReportSummary {
    const job = jobs.get(report.job_id)!;
    const customer = customers.get(job.customer_id)!;
    return {
      id: report.id,
      job_id: job.id,
      job_reference: job.reference,
      job_type: job.job_type,
      customer: { id: customer.id, name: customer.name },
      site_address: address("site", job),
      painter: person(report.painter_id)!,
      completed_on: job.completed_on!,
      submitted_at: report.submitted_at,
      photo_count: (photos.get(report.id) ?? []).length,
      review_status: report.review_status,
      billing_status: billingStatusOf(job.id),
    };
  }

  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  function sorted(rows: ReportState[], sort: string): ReportState[] {
    const ref = (r: ReportState) => jobs.get(r.job_id)!.reference;
    const done = (r: ReportState) => jobs.get(r.job_id)!.completed_on ?? "";
    return [...rows].sort((a, b) =>
      sort === "submitted_asc"
        ? cmp(a.submitted_at, b.submitted_at) || cmp(ref(a), ref(b))
        : cmp(done(b), done(a)) || cmp(b.submitted_at, a.submitted_at) || cmp(ref(b), ref(a)),
    );
  }

  function matches(report: ReportState, f: ReportFilters): boolean {
    const job = jobs.get(report.job_id)!;
    const customer = customers.get(job.customer_id)!;
    if (f.review_status && report.review_status !== f.review_status) return false;
    if (f.billing_status && billingStatusOf(job.id) !== f.billing_status) return false;
    if (f.painter_id && report.painter_id !== f.painter_id) return false;
    if (f.customer_id && job.customer_id !== f.customer_id) return false;
    if (f.date_from && !(job.completed_on !== null && job.completed_on >= f.date_from)) return false;
    if (f.date_to && !(job.completed_on !== null && job.completed_on <= f.date_to)) return false;
    if (f.q) {
      const q = f.q.toLowerCase();
      const squashed = q.replace(/\s+/g, "");
      const fields = [customer.name, job.site_line1, job.site_line2, job.site_town, job.site_county, job.site_postcode, job.reference];
      const hit =
        fields.some((v) => v !== null && v.toLowerCase().includes(q)) ||
        (squashed !== "" && job.site_postcode.toLowerCase().replace(/ /g, "").includes(squashed));
      if (!hit) return false;
    }
    return true;
  }

  const allReports = () => [...reports.values()];

  function pageOf<T>(rows: T[], page: number, pageSize: number) {
    const start = (page - 1) * pageSize;
    return { items: rows.slice(start, start + pageSize), total: rows.length, page, page_size: pageSize };
  }

  function reportDetail(id: string): ReportDetail {
    const report = reports.get(id);
    if (!report) throw NOT_FOUND("Report");
    const job = jobs.get(report.job_id)!;
    const customer = customers.get(job.customer_id)!;
    const inv = chosenInvoice(job.id);
    const quote = chosenQuote(job.id);
    const payments = data.payments
      .filter((p) => (inv && p.kind === "invoice" && p.invoice_id === inv.id) || (quote && p.kind === "deposit" && p.quote_id === quote.id))
      .sort((a, b) => cmp(a.received_at, b.received_at) || cmp(a.id, b.id));

    let invoiceSummary: InvoiceSummary | null = null;
    if (inv) {
      const paid = payments.filter((p) => p.kind === "invoice").reduce((s, p) => s + p.amount_pence, 0);
      invoiceSummary = {
        id: inv.id,
        number: inv.number,
        status: invoiceStatus(inv),
        subtotal_pence: inv.subtotal_pence,
        vat_pence: inv.vat_pence,
        deposit_applied_pence: inv.deposit_applied_pence,
        total_pence: inv.total_pence,
        paid_pence: paid,
        balance_pence: balanceOf(inv.total_pence, paid),
        currency: "GBP",
        issue_date: inv.issue_date,
        due_date: inv.due_date,
      };
    }
    let quoteSummary: QuoteSummary | null = null;
    if (quote) {
      quoteSummary = {
        id: quote.id,
        reference: quote.reference,
        status: quote.status,
        total_pence: quote.total_pence,
        deposit_pence: quote.deposit_pence,
        deposit_paid_pence: payments.filter((p) => p.kind === "deposit").reduce((s, p) => s + p.amount_pence, 0),
        currency: "GBP",
        issued_on: quote.issued_on,
        accepted_on: quote.accepted_on,
      };
    }

    const stageOrder = { before: 0, during: 1, after: 2 } as const;
    const reportPhotos: ReportPhoto[] = [...(photos.get(id) ?? [])]
      .sort((a, b) => stageOrder[a.stage] - stageOrder[b.stage] || cmp(a.taken_at, b.taken_at) || a.position - b.position || cmp(a.id, b.id))
      .map((p) => ({
        id: p.id,
        stage: p.stage,
        caption: p.caption,
        taken_at: p.taken_at,
        width: p.width,
        height: p.height,
        url: placeholderDataUri(p, job.reference, "full"),
        thumb_url: placeholderDataUri(p, job.reference, "thumb"),
        checklist_item_id: null,
        source: "camera",
        taken_at_source: "device_clock",
        received_at: null,
        clock_offset_seconds: null,
        location: null,
      }));

    const customerDetail: CustomerDetail = {
      id: customer.id,
      name: customer.name,
      customer_type: customer.customer_type,
      contact_name: customer.contact_name,
      email: customer.email,
      phone: customer.phone,
      billing_address: address("billing", customer),
      job_count: data.jobs.filter((j) => j.customer_id === customer.id).length,
    };

    return {
      id: report.id,
      review_status: report.review_status,
      submitted_at: report.submitted_at,
      submitted_by: person(report.painter_id)!,
      pending_photo_count: 0,
      device_submitted_at: null,
      submit_clock_offset_seconds: null,
      sign_off: null,
      reviewed_at: report.reviewed_at,
      reviewed_by: person(report.reviewed_by_id),
      version: report.version,
      last_changed_at: report.last_changed_at,
      last_changed_by: person(report.last_changed_by_id),
      painter_notes: report.painter_notes,
      manager_notes: report.manager_notes,
      billing_status: billingStatusOf(job.id),
      job: {
        id: job.id,
        reference: job.reference,
        job_type: job.job_type,
        title: job.title,
        status: job.status,
        site_address: address("site", job),
        notes: job.notes,
        scheduled_start: job.scheduled_start,
        completed_on: job.completed_on,
      },
      customer: customerDetail,
      painter: person(report.painter_id)!,
      checklist: (checklist.get(id) ?? []).map(
        (i): ChecklistItem => ({ id: i.id, label: i.label, done: i.done, note: i.note, cannot_do: i.cannot_do, removed: false }),
      ),
      photos: reportPhotos,
      quote: quoteSummary,
      invoice: invoiceSummary,
      payments: payments.map(
        (p): Payment => ({ id: p.id, kind: p.kind, amount_pence: p.amount_pence, currency: "GBP", received_at: p.received_at, method: p.method }),
      ),
    };
  }

  function customerRecord(id: string): CustomerRecord {
    const c = customers.get(id);
    if (!c) throw NOT_FOUND("Customer");
    const ownReports = allReports().filter((r) => jobs.get(r.job_id)!.customer_id === id);
    return {
      id: c.id,
      name: c.name,
      customer_type: c.customer_type,
      contact_name: c.contact_name,
      email: c.email,
      phone: c.phone,
      billing_address: address("billing", c),
      version: c.version,
      last_changed_at: c.last_changed_at,
      last_changed_by: person(c.last_changed_by_id),
      impact: {
        job_count: data.jobs.filter((j) => j.customer_id === id).length,
        report_count: ownReports.length,
        reviewed_report_count: ownReports.filter((r) => r.review_status === "reviewed").length,
        issued_invoice_count: data.invoices.filter((i) => i.customer_id === id && i.state === "issued").length,
      },
    };
  }

  // ---- request body checks ----

  function isObject(body: unknown): body is Record<string, unknown> {
    return typeof body === "object" && body !== null && !Array.isArray(body);
  }

  function requireObject(body: unknown): Record<string, unknown> {
    if (!isObject(body)) throw validation([{ loc: ["body"], message: "Input should be a valid object." }]);
    return body;
  }

  function checkVersion(body: Record<string, unknown>, errors: FieldIssue[]) {
    if (!("version" in body)) errors.push({ loc: ["body", "version"], message: "Field required." });
    else if (typeof body.version !== "number" || !Number.isInteger(body.version) || body.version < 1)
      errors.push({ loc: ["body", "version"], message: "Input should be a whole number of at least 1." });
  }

  function checkNotes(body: Record<string, unknown>, key: string, max: number, loc: (string | number)[], errors: FieldIssue[]) {
    if (!(key in body) || body[key] === null) return;
    const v = body[key];
    if (typeof v !== "string") errors.push({ loc: [...loc, key], message: "Input should be a valid string." });
    else if (Array.from(v).length > max) errors.push({ loc: [...loc, key], message: `String should have at most ${max} characters.` });
    else if (NUL_OR_SURROGATE.test(v)) errors.push({ loc: [...loc, key], message: "Remove invalid characters." });
  }

  function rejectExtra(body: Record<string, unknown>, allowed: string[], loc: (string | number)[], errors: FieldIssue[]) {
    for (const key of Object.keys(body))
      if (!allowed.includes(key)) errors.push({ loc: [...loc, key], message: "Extra inputs are not permitted." });
  }

  function requireUuid(value: string, what: string): string {
    if (!UUID.test(value)) throw validation([{ loc: ["path", what], message: "Input should be a valid UUID." }]);
    return value.toLowerCase();
  }

  // ---- public surface ----

  return {
    today,

    // auth
    demoAccounts: (): DemoAccount[] => data.demo_accounts.map((a) => ({ ...a })),

    /** Only the published demo accounts, with their published passwords, can sign in. */
    login(email: string, password: string): User {
      const wanted = email.trim().toLowerCase();
      const account = data.demo_accounts.find((a) => a.email.toLowerCase() === wanted);
      const user = account ? data.users.find((u) => u.email.toLowerCase() === wanted && u.is_active) : undefined;
      if (!account || !user || account.password !== password) {
        throw new MockProblem(401, "invalid_credentials", "Email or password is incorrect.");
      }
      return toUser(user.id);
    },
    userById: (id: string): User | null => (users.has(id) ? toUser(id) : null),

    branding: (): Branding => ({
      company_name: settings.company_name,
      theme: { ...settings.theme },
      uk_only_contact_details: settings.uk_only_contact_details,
    }),

    // admin
    adminSettings: (): AdminSettings => ({ ...settings, theme: { ...settings.theme } }),

    updateAdminSettings(actor: User, raw: unknown): AdminSettings {
      const body = requireObject(raw);
      const errors: FieldIssue[] = [];
      rejectExtra(body, ["company_name", "theme", "uk_only_contact_details"], ["body"], errors);
      let name: string | undefined;
      if ("company_name" in body) {
        if (typeof body.company_name !== "string") errors.push({ loc: ["body", "company_name"], message: "Input should be a valid string." });
        else {
          const r = validateCompanyName(body.company_name);
          if (r.error !== undefined) errors.push({ loc: ["body", "company_name"], message: r.error });
          else name = r.value;
        }
      }
      let theme: { primary: string; accent: string } | undefined;
      if ("theme" in body) {
        const t = body.theme;
        if (!isObject(t)) errors.push({ loc: ["body", "theme"], message: "Input should be a valid object." });
        else {
          rejectExtra(t, ["primary", "accent"], ["body", "theme"], errors);
          for (const key of ["primary", "accent"] as const) {
            const v = t[key];
            if (typeof v !== "string" || !HEX.test(v)) errors.push({ loc: ["body", "theme", key], message: "Use a six-digit hex colour." });
          }
          if (errors.length === 0) theme = { primary: (t.primary as string).toUpperCase(), accent: (t.accent as string).toUpperCase() };
        }
      }
      let ukOnly: boolean | undefined;
      if ("uk_only_contact_details" in body) {
        if (typeof body.uk_only_contact_details !== "boolean")
          errors.push({ loc: ["body", "uk_only_contact_details"], message: "Input should be true or false." });
        else ukOnly = body.uk_only_contact_details;
      }
      if (errors.length > 0) throw validation(errors);

      if (theme) {
        const failures: FieldIssue[] = [];
        for (const key of ["primary", "accent"] as const) {
          const { ratio, background } = weakestContrast(theme[key], settings.theme.surface);
          if (!meetsAA(ratio)) {
            const shown = reportRatio(ratio);
            failures.push({
              loc: ["body", "theme", key],
              message: `Contrast ${shown.toFixed(2)}:1 against ${background === "white" ? "white" : "the surface colour"} is below the required ${REQUIRED_RATIO}:1.`,
              measured_ratio: shown,
              required_ratio: REQUIRED_RATIO,
            });
          }
        }
        if (failures.length > 0) {
          throw new MockProblem(
            422,
            "contrast_too_low",
            `Colours must have at least ${REQUIRED_RATIO}:1 contrast against both white and the surface colour.`,
            {},
            failures,
          );
        }
      }

      const changes: AuditChange[] = [];
      const change = (field: AuditChange["field"], oldValue: string | boolean, newValue: string | boolean) => {
        if (oldValue !== newValue) changes.push({ field, item_id: null, item_label: null, old_value: oldValue, new_value: newValue });
      };
      if (name !== undefined) change("company_name", settings.company_name, name);
      if (theme) {
        change("theme_primary", settings.theme.primary, theme.primary);
        change("theme_accent", settings.theme.accent, theme.accent);
      }
      if (ukOnly !== undefined) change("uk_only_contact_details", settings.uk_only_contact_details, ukOnly);
      if (changes.length === 0) return this.adminSettings();

      const when = iso(clock());
      if (name !== undefined) settings.company_name = name;
      if (theme) settings.theme = { ...settings.theme, ...theme };
      if (ukOnly !== undefined) settings.uk_only_contact_details = ukOnly;
      settings.updated_at = when;
      settings.updated_by = { id: actor.id, name: actor.full_name };
      record(actor, "settings.changed", changes, { settings: true }, when);
      return this.adminSettings();
    },

    settingsHistory: (): AuditHistory => history((e) => e.settings),

    // manager reads
    dashboard(): Dashboard {
      const [y, m] = today.split("-").map(Number) as [number, number];
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const start = `${today.slice(0, 7)}-01`;
      const end = `${today.slice(0, 7)}-${String(last).padStart(2, "0")}`;
      const rows = allReports();
      const inMonth = (d: string | null) => d !== null && d >= start && d <= end;
      const live = data.invoices.filter((i) => ["sent", "part_paid", "overdue"].includes(invoiceStatus(i)));
      const queue = sorted(rows.filter((r) => r.review_status === "awaiting_review"), "submitted_asc").slice(0, 5);
      const recent = [...rows]
        .sort((a, b) => cmp(b.submitted_at, a.submitted_at) || cmp(jobs.get(b.job_id)!.reference, jobs.get(a.job_id)!.reference))
        .slice(0, 5);
      return {
        as_of: iso(clock()),
        period_start: start,
        period_end: end,
        reports_awaiting_review: rows.filter((r) => r.review_status === "awaiting_review").length,
        jobs_completed_this_month: data.jobs.filter((j) => inMonth(j.completed_on)).length,
        invoiced_this_month_pence: data.invoices.filter((i) => i.state === "issued" && inMonth(i.issue_date)).reduce((s, i) => s + i.total_pence, 0),
        outstanding_pence: live.reduce((s, i) => s + balanceOf(i.total_pence, paidOn(i)), 0),
        overdue_invoice_count: data.invoices.filter((i) => invoiceStatus(i) === "overdue").length,
        currency: "GBP",
        review_queue: queue.map(summary),
        recent_reports: recent.map(summary),
      };
    },

    painters: (): PersonRef[] =>
      data.users
        .filter((u) => u.role === "painter")
        .sort((a, b) => cmp(a.full_name, b.full_name) || cmp(a.id, b.id))
        .map((u) => ({ id: u.id, name: u.full_name })),

    listReports(f: ReportFilters, page: number, pageSize: number): ReportPage {
      const rows = sorted(allReports().filter((r) => matches(r, f)), f.sort ?? "default");
      const p = pageOf(rows, page, pageSize);
      return { ...p, items: p.items.map(summary) };
    },

    report: (id: string) => reportDetail(requireUuid(id, "report_id")),

    reportHistory(id: string): AuditHistory {
      const report = reports.get(requireUuid(id, "report_id"));
      if (!report) throw NOT_FOUND("Report");
      const customerId = jobs.get(report.job_id)!.customer_id;
      return history((e) => e.report_id === report.id || e.customer_id === customerId);
    },

    listInvoices(status: string | undefined, page: number, pageSize: number): InvoicePage {
      const rows = data.invoices
        .filter((i) => !status || invoiceStatus(i) === status)
        .sort((a, b) => {
          // issue_date descending with drafts (no date) first, then number descending
          if (a.issue_date !== b.issue_date) {
            if (a.issue_date === null) return -1;
            if (b.issue_date === null) return 1;
            return a.issue_date < b.issue_date ? 1 : -1;
          }
          return cmp(b.number, a.number);
        });
      const p = pageOf(rows, page, pageSize);
      return {
        ...p,
        items: p.items.map((i): InvoiceRow => {
          const job = jobs.get(i.job_id)!;
          const paid = paidOn(i);
          return {
            id: i.id,
            number: i.number,
            status: invoiceStatus(i),
            customer: { id: i.customer_id, name: customers.get(i.customer_id)!.name },
            job_id: job.id,
            job_reference: job.reference,
            report_id: reportByJob.get(job.id) ?? null,
            total_pence: i.total_pence,
            paid_pence: paid,
            balance_pence: balanceOf(i.total_pence, paid),
            currency: "GBP",
            issue_date: i.issue_date,
            due_date: i.due_date,
          };
        }),
      };
    },

    // manager writes
    reviewReport(actor: User, id: string, raw: unknown): ReportDetail {
      const body = requireObject(raw);
      const errors: FieldIssue[] = [];
      rejectExtra(body, ["version"], ["body"], errors);
      checkVersion(body, errors);
      if (errors.length > 0) throw validation(errors);
      const report = reports.get(requireUuid(id, "report_id"));
      if (!report) throw NOT_FOUND("Report");
      if (report.version !== body.version) throw this.versionConflict(report);
      if (report.review_status === "reviewed") {
        const reviewer = person(report.reviewed_by_id);
        throw new MockProblem(
          409,
          "already_reviewed",
          `Already reviewed by ${reviewer?.name ?? "another manager"} at ${report.reviewed_at}.`,
          { current_version: report.version, reviewed_at: report.reviewed_at, reviewed_by: reviewer },
        );
      }
      const when = iso(clock());
      report.review_status = "reviewed";
      report.reviewed_at = when;
      report.reviewed_by_id = actor.id;
      report.version += 1;
      report.last_changed_at = when;
      report.last_changed_by_id = actor.id;
      record(
        actor,
        "report.reviewed",
        [{ field: "review_status", item_id: null, item_label: null, old_value: "awaiting_review", new_value: "reviewed" }],
        { report_id: report.id },
        when,
      );
      return reportDetail(report.id);
    },

    versionConflict(report: ReportState, extra: Record<string, unknown> = {}): MockProblem {
      return new MockProblem(409, "version_conflict", "This report was changed after you loaded it.", {
        current_version: report.version,
        last_changed_at: report.last_changed_at,
        last_changed_by: person(report.last_changed_by_id),
        review_status: report.review_status,
        reviewed_at: report.reviewed_at,
        reviewed_by: person(report.reviewed_by_id),
        ...extra,
      });
    },

    updateReport(actor: User, id: string, raw: unknown): ReportDetail {
      const body = requireObject(raw);
      const errors: FieldIssue[] = [];
      rejectExtra(body, ["version", "painter_notes", "manager_notes", "checklist"], ["body"], errors);
      checkVersion(body, errors);
      checkNotes(body, "painter_notes", 5000, ["body"], errors);
      checkNotes(body, "manager_notes", 5000, ["body"], errors);
      const sentItems: { id: string; done?: boolean; note?: string | null; noteSent: boolean }[] = [];
      if ("checklist" in body) {
        const list = body.checklist;
        if (!Array.isArray(list) || list.length < 1 || list.length > 100) {
          errors.push({ loc: ["body", "checklist"], message: "Send a list of 1 to 100 checklist items." });
        } else {
          const seen = new Set<string>();
          list.forEach((item: unknown, index) => {
            const at = ["body", "checklist", index];
            if (!isObject(item)) return void errors.push({ loc: at, message: "Input should be a valid object." });
            rejectExtra(item, ["id", "done", "note"], at, errors);
            if (typeof item.id !== "string" || !UUID.test(item.id)) errors.push({ loc: [...at, "id"], message: "Input should be a valid UUID." });
            else if (seen.has(item.id.toLowerCase())) errors.push({ loc: at, message: "Each checklist item may be sent once." });
            else seen.add(item.id.toLowerCase());
            if ("done" in item && typeof item.done !== "boolean") errors.push({ loc: [...at, "done"], message: "Use true or false." });
            checkNotes(item, "note", 500, at, errors);
            if (!("done" in item) && !("note" in item)) errors.push({ loc: at, message: "Send done, note or both." });
            if (typeof item.id === "string")
              sentItems.push({
                id: item.id.toLowerCase(),
                done: typeof item.done === "boolean" ? item.done : undefined,
                note: "note" in item ? ((item.note as string | null) ?? null) : undefined,
                noteSent: "note" in item,
              });
          });
        }
      }
      if (!["painter_notes", "manager_notes", "checklist"].some((k) => k in body))
        errors.push({ loc: ["body"], message: "Send at least one field to change." });
      if (errors.length > 0) throw validation(errors);

      const report = reports.get(requireUuid(id, "report_id"));
      if (!report) throw NOT_FOUND("Report");
      const items = new Map((checklist.get(report.id) ?? []).map((i) => [i.id, i]));
      const foreign = sentItems
        .map((s, index) => ({ s, index }))
        .filter(({ s }) => !items.has(s.id))
        .map(({ index }): FieldIssue => ({ loc: ["body", "checklist", index, "id"], message: "Checklist item does not belong to this report." }));
      if (foreign.length > 0) throw validation(foreign);

      if (report.version !== body.version) {
        const current: Record<string, unknown> = {};
        if ("painter_notes" in body) current.painter_notes = report.painter_notes;
        if ("manager_notes" in body) current.manager_notes = report.manager_notes;
        if (sentItems.length > 0) current.checklist = sentItems.map((s) => ({ id: s.id, done: items.get(s.id)!.done, note: items.get(s.id)!.note }));
        throw this.versionConflict(report, { current });
      }

      const changes: AuditChange[] = [];
      const edits: (() => void)[] = [];
      const field = (name: "painter_notes" | "manager_notes") => {
        if (!(name in body)) return;
        const next = emptyToNull(body[name] as string | null);
        if (next !== report[name]) {
          changes.push({ field: name, item_id: null, item_label: null, old_value: report[name], new_value: next });
          edits.push(() => void (report[name] = next));
        }
      };
      field("painter_notes");
      field("manager_notes");
      for (const s of sentItems) {
        const item = items.get(s.id)!;
        if (s.done !== undefined && s.done !== item.done) {
          changes.push({ field: "checklist_done", item_id: item.id, item_label: item.label, old_value: item.done, new_value: s.done });
          edits.push(() => {
            item.done = s.done!;
            if (item.done) item.cannot_do = false;
          });
        }
        if (s.noteSent) {
          const next = emptyToNull(s.note);
          if (next !== item.note) {
            changes.push({ field: "checklist_note", item_id: item.id, item_label: item.label, old_value: item.note, new_value: next });
            edits.push(() => void (item.note = next));
          }
        }
      }
      if (changes.length === 0) return reportDetail(report.id);

      const when = iso(clock());
      edits.forEach((apply) => apply());
      report.version += 1;
      report.last_changed_at = when;
      report.last_changed_by_id = actor.id;
      record(actor, "report.edited", changes, { report_id: report.id }, when);
      if (report.review_status === "reviewed") {
        const previous = person(report.reviewed_by_id);
        const previousAt = report.reviewed_at;
        report.review_status = "awaiting_review";
        report.reviewed_at = null;
        report.reviewed_by_id = null;
        record(
          actor,
          "report.reopened",
          [
            { field: "review_status", item_id: null, item_label: null, old_value: "reviewed", new_value: "awaiting_review" },
            { field: "reviewed_by", item_id: null, item_label: null, old_value: previous?.name ?? "", new_value: null },
            { field: "reviewed_at", item_id: null, item_label: null, old_value: previousAt, new_value: null },
          ],
          { report_id: report.id },
          when,
        );
      }
      return reportDetail(report.id);
    },

    customer: (id: string) => customerRecord(requireUuid(id, "customer_id")),

    customerHistory(id: string): AuditHistory {
      const customer = customers.get(requireUuid(id, "customer_id"));
      if (!customer) throw NOT_FOUND("Customer");
      return history((e) => e.customer_id === customer.id);
    },

    updateCustomer(actor: User, id: string, raw: unknown): CustomerRecord {
      const body = requireObject(raw);
      const errors: FieldIssue[] = [];
      rejectExtra(body, ["version", "name", "contact_name", "email", "phone", "billing_address"], ["body"], errors);
      checkVersion(body, errors);
      // Field -> (API loc, stored attribute, audit field, validator key)
      const top: [string, keyof RawCustomer, AuditChange["field"], CustomerField][] = [
        ["name", "name", "customer_name", "name"],
        ["contact_name", "contact_name", "customer_contact_name", "contact_name"],
        ["email", "email", "customer_email", "email"],
        ["phone", "phone", "customer_phone", "phone"],
      ];
      const parts: [string, keyof RawCustomer, AuditChange["field"], CustomerField][] = [
        ["line1", "billing_line1", "customer_billing_line1", "line1"],
        ["line2", "billing_line2", "customer_billing_line2", "line2"],
        ["town", "billing_town", "customer_billing_town", "town"],
        ["county", "billing_county", "customer_billing_county", "county"],
        ["postcode", "billing_postcode", "customer_billing_postcode", "postcode"],
      ];
      const edits: { attribute: keyof RawCustomer; auditField: AuditChange["field"]; key: string; value: string | null }[] = [];
      const check = (loc: string[], value: unknown, attribute: keyof RawCustomer, auditField: AuditChange["field"], validator: CustomerField) => {
        if (value !== null && typeof value !== "string") return void errors.push({ loc: ["body", ...loc], message: "Input should be a valid string." });
        const r = VALIDATORS[validator](value, settings.uk_only_contact_details);
        if (!r.ok) errors.push({ loc: ["body", ...loc], message: r.message });
        else edits.push({ attribute, auditField, key: loc.join("."), value: r.value });
      };
      for (const [key, attribute, auditField, validator] of top) if (key in body) check([key], body[key], attribute, auditField, validator);
      if ("billing_address" in body) {
        const a = body.billing_address;
        if (!isObject(a)) errors.push({ loc: ["body", "billing_address"], message: "Input should be a valid object." });
        else {
          rejectExtra(a, parts.map((p) => p[0]), ["body", "billing_address"], errors);
          for (const [key, attribute, auditField, validator] of parts)
            if (key in a) check(["billing_address", key], a[key], attribute, auditField, validator);
        }
      }
      if (errors.length > 0) throw validation(errors);

      const customer = customers.get(requireUuid(id, "customer_id"));
      if (!customer) throw NOT_FOUND("Customer");
      if (customer.version !== body.version) {
        const current: Record<string, unknown> = {};
        const billing: Record<string, unknown> = {};
        for (const e of edits) {
          const [head, tail] = e.key.split(".");
          if (tail) billing[tail] = customer[e.attribute];
          else current[head!] = customer[e.attribute];
        }
        if (Object.keys(billing).length > 0) current.billing_address = billing;
        throw new MockProblem(409, "version_conflict", "This customer was changed after you loaded it.", {
          current_version: customer.version,
          last_changed_at: customer.last_changed_at,
          last_changed_by: person(customer.last_changed_by_id),
          current,
        });
      }
      const changes = edits
        .filter((e) => customer[e.attribute] !== e.value)
        .map((e): AuditChange => ({
          field: e.auditField,
          item_id: null,
          item_label: null,
          old_value: customer[e.attribute] as string | null,
          new_value: e.value,
        }));
      if (changes.length === 0) return customerRecord(customer.id);
      const when = iso(clock());
      for (const e of edits) (customer as unknown as Record<string, unknown>)[e.attribute] = e.value;
      customer.version += 1;
      customer.last_changed_at = when;
      customer.last_changed_by_id = actor.id;
      record(actor, "customer.edited", changes, { customer_id: customer.id }, when);
      return customerRecord(customer.id);
    },
  };
}

export type MockBackend = ReturnType<typeof createMockBackend>;
