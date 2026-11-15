import { ApiError, parseConflict, toApiError, type ReportDetail, type ReportPage, type CustomerRecord, type AuditHistory, type Dashboard } from "@jobproof/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createMockBackend } from "./backend";
import { createMockFetch } from "./handler";
import mockData from "./mockData.json";
import type { MockData } from "./rawTypes";

const data = mockData as unknown as MockData;
const BASE = "http://mock.test";

function setup() {
  const clock = { now: new Date("2026-11-20T10:00:00Z") };
  const backend = createMockBackend(data, { now: () => clock.now });
  const mockFetch = createMockFetch(backend);
  async function call<T = unknown>(method: string, path: string, opts: { token?: string | null; body?: unknown } = {}) {
    const headers: Record<string, string> = {};
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const res = await mockFetch(`${BASE}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T, res };
  }
  async function signIn(email: string, password: string) {
    const r = await call<{ access_token: string }>("POST", "/api/v1/auth/login", { body: { email, password } });
    return r.body.access_token;
  }
  return { backend, call, signIn };
}

const manager = data.demo_accounts.find((a) => a.role === "manager")!;
const admin = data.demo_accounts.find((a) => a.role === "admin")!;

describe("mock API: sign-in", () => {
  it("lists the published demo accounts without authentication", async () => {
    const { call } = setup();
    const r = await call<{ email: string }[]>("GET", "/api/v1/auth/demo-accounts");
    expect(r.status).toBe(200);
    expect(r.body.map((a) => a.email)).toEqual(data.demo_accounts.map((a) => a.email));
  });

  it("signs in every demo account with its published password", async () => {
    const { call } = setup();
    for (const account of data.demo_accounts) {
      const r = await call<{ token_type: string; user: { role: string; email: string } }>("POST", "/api/v1/auth/login", {
        body: { email: account.email.toUpperCase(), password: account.password },
      });
      expect(r.status).toBe(200);
      expect(r.body.token_type).toBe("bearer");
      expect(r.body.user).toMatchObject({ role: account.role, email: account.email });
    }
  });

  it("rejects a wrong password, an unknown email and a user that is not a demo account", async () => {
    const { call } = setup();
    const painter2 = data.users.find((u) => u.role === "painter" && !data.demo_accounts.some((a) => a.email === u.email))!;
    for (const body of [
      { email: manager.email, password: "wrong" },
      { email: "nobody@jobproof.test", password: manager.password },
      { email: painter2.email, password: manager.password },
      { email: manager.email, password: "" },
    ]) {
      const r = await call<{ code: string }>("POST", "/api/v1/auth/login", { body });
      expect(r.status).toBe(401);
      expect(r.body.code).toBe("invalid_credentials");
      expect(r.res.headers.get("Content-Type")).toBe("application/problem+json");
    }
  });

  it("answers 401 without a token and 403 for the wrong role", async () => {
    const { call, signIn } = setup();
    expect((await call("GET", "/api/v1/manager/dashboard")).status).toBe(401);
    expect((await call("GET", "/api/v1/manager/dashboard", { token: "garbage" })).status).toBe(401);
    const m = await signIn(manager.email, manager.password);
    const a = await signIn(admin.email, admin.password);
    expect((await call("GET", "/api/v1/admin/settings", { token: m })).status).toBe(403);
    expect((await call("GET", "/api/v1/manager/dashboard", { token: a })).status).toBe(403);
    const me = await call<{ role: string }>("GET", "/api/v1/auth/me", { token: m });
    expect(me.body.role).toBe("manager");
  });

  it("serves branding publicly", async () => {
    const { call } = setup();
    const r = await call<{ company_name: string }>("GET", "/api/v1/branding");
    expect(r.status).toBe(200);
    expect(r.body.company_name).toBe(data.settings.company_name);
  });
});

describe("mock API: report list", () => {
  let token: string;
  let call: ReturnType<typeof setup>["call"];
  beforeEach(async () => {
    const s = setup();
    call = s.call;
    token = await s.signIn(manager.email, manager.password);
  });
  const list = (qs = "") => call<ReportPage>("GET", `/api/v1/manager/reports${qs}`, { token });

  it("paginates with the total of all matching rows", async () => {
    const first = (await list("?page_size=10")).body;
    expect(first.total).toBe(data.reports.length);
    expect(first.items).toHaveLength(10);
    expect(first.page).toBe(1);
    expect(first.page_size).toBe(10);
    const last = (await list(`?page_size=10&page=${Math.ceil(first.total / 10)}`)).body;
    expect(last.items).toHaveLength(first.total % 10 || 10);
    expect((await list("?page_size=10&page=99")).body.items).toEqual([]);
    const ids = new Set([...first.items, ...(await list("?page_size=10&page=2")).body.items].map((i) => i.id));
    expect(ids.size).toBe(20);
  });

  it("defaults to completed_on descending, then submitted_at, then reference descending", async () => {
    const items = (await list("?page_size=100")).body.items;
    for (let i = 1; i < items.length; i++) {
      const a = items[i - 1]!;
      const b = items[i]!;
      const key = (r: typeof a) => [r.completed_on, r.submitted_at, r.job_reference];
      expect(key(a) >= key(b)).toBe(true);
    }
  });

  it("sorts the review queue oldest first", async () => {
    const items = (await list("?review_status=awaiting_review&sort=submitted_asc&page_size=100")).body.items;
    expect(items.length).toBeGreaterThan(0);
    const times = items.map((r) => r.submitted_at);
    expect(times).toEqual([...times].sort());
  });

  it("filters by review status, billing status, painter, customer and date range, combined with AND", async () => {
    const awaiting = (await list("?review_status=awaiting_review&page_size=100")).body;
    expect(awaiting.items.every((r) => r.review_status === "awaiting_review")).toBe(true);
    expect(awaiting.total).toBe(data.reports.filter((r) => r.review_status === "awaiting_review").length);

    const overdue = (await list("?billing_status=overdue&page_size=100")).body;
    expect(overdue.total).toBeGreaterThan(0);
    expect(overdue.items.every((r) => r.billing_status === "overdue")).toBe(true);

    const sample = (await list("?page_size=1")).body.items[0]!;
    const byPainter = (await list(`?painter_id=${sample.painter.id}&page_size=100`)).body;
    expect(byPainter.items.every((r) => r.painter.id === sample.painter.id)).toBe(true);
    const byCustomer = (await list(`?customer_id=${sample.customer.id}&page_size=100`)).body;
    expect(byCustomer.items.every((r) => r.customer.id === sample.customer.id)).toBe(true);
    expect((await list("?customer_id=00000000-0000-4000-8000-000000000000")).body.total).toBe(0);

    const ranged = (await list(`?date_from=${sample.completed_on}&date_to=${sample.completed_on}&page_size=100`)).body;
    expect(ranged.total).toBeGreaterThan(0);
    expect(ranged.items.every((r) => r.completed_on === sample.completed_on)).toBe(true);

    const both = (await list(`?review_status=awaiting_review&painter_id=${sample.painter.id}&page_size=100`)).body;
    expect(both.items.every((r) => r.review_status === "awaiting_review" && r.painter.id === sample.painter.id)).toBe(true);
  });

  it("searches customer, address (also without spaces in the postcode) and job reference, ignoring case", async () => {
    const sample = (await list("?page_size=1")).body.items[0]!;
    const ref = await list(`?q=${encodeURIComponent(sample.job_reference.toLowerCase())}`);
    expect(ref.body.items.map((r) => r.id)).toContain(sample.id);
    const name = await list(`?q=${encodeURIComponent(sample.customer.name.toUpperCase())}&page_size=100`);
    expect(name.body.items.map((r) => r.id)).toContain(sample.id);
    const compact = sample.site_address.postcode.replace(" ", "").toLowerCase();
    const post = await list(`?q=${compact}&page_size=100`);
    expect(post.body.items.map((r) => r.id)).toContain(sample.id);
    expect((await list("?q=zzzz-no-such-thing")).body.total).toBe(0);
    // blank after trimming means no search
    expect((await list("?q=%20%20")).body.total).toBe(data.reports.length);
  });

  it("rejects invalid parameters with 422 and an errors list", async () => {
    for (const qs of ["?page=0", "?page_size=101", "?review_status=bogus", "?painter_id=nope", "?date_from=2026-02-01&date_to=2026-01-01", "?date_from=x", "?q="]) {
      const r = await call<{ code: string; errors: { loc: string[] }[] }>("GET", `/api/v1/manager/reports${qs}`, { token });
      expect(r.status, qs).toBe(422);
      expect(r.body.code).toBe("validation_error");
      expect(r.body.errors.length).toBeGreaterThan(0);
    }
  });
});

describe("mock API: detail, dashboard, invoices, painters", () => {
  it("returns a full report with billing, photos as inline images and no network URLs", async () => {
    const { call, signIn } = setup();
    const token = await signIn(manager.email, manager.password);
    const first = (await call<ReportPage>("GET", "/api/v1/manager/reports?page_size=100", { token })).body.items;
    const withInvoice = first.find((r) => r.billing_status === "paid")!;
    const r = (await call<ReportDetail>("GET", `/api/v1/manager/reports/${withInvoice.id}`, { token })).body;
    expect(r.invoice?.status).toBe("paid");
    expect(r.invoice?.balance_pence).toBe(0);
    expect(r.billing_status).toBe(withInvoice.billing_status);
    expect(r.photos.length).toBe(withInvoice.photo_count);
    expect(r.photos[0]!.url.startsWith("data:image/svg+xml")).toBe(true);
    expect(decodeURIComponent(r.photos[0]!.thumb_url)).toContain('width="400"');
    expect(r.checklist.length).toBeGreaterThan(0);
    expect(r.customer.job_count).toBeGreaterThan(0);
    const stages = r.photos.map((p) => p.stage);
    expect(stages).toEqual([...stages].sort((a, b) => ["before", "during", "after"].indexOf(a) - ["before", "during", "after"].indexOf(b)));
    expect((await call("GET", "/api/v1/manager/reports/00000000-0000-4000-8000-000000000000", { token })).status).toBe(404);
    expect((await call("GET", "/api/v1/manager/reports/not-a-uuid", { token })).status).toBe(422);
  });

  it("builds the dashboard from the same data as the list", async () => {
    const { call, signIn } = setup();
    const token = await signIn(manager.email, manager.password);
    const d = (await call<Dashboard>("GET", "/api/v1/manager/dashboard", { token })).body;
    expect(d.currency).toBe("GBP");
    expect(d.period_start).toBe("2026-11-01");
    expect(d.period_end).toBe("2026-11-30");
    const awaiting = (await call<ReportPage>("GET", "/api/v1/manager/reports?review_status=awaiting_review", { token })).body.total;
    expect(d.reports_awaiting_review).toBe(awaiting);
    expect(d.review_queue.length).toBe(Math.min(5, awaiting));
    expect(d.recent_reports).toHaveLength(5);
    expect(d.outstanding_pence).toBeGreaterThan(0);
    expect(d.overdue_invoice_count).toBeGreaterThan(0);
    expect(Number.isInteger(d.invoiced_this_month_pence)).toBe(true);
  });

  it("lists invoices with status filter, drafts first and paging", async () => {
    const { call, signIn } = setup();
    const token = await signIn(manager.email, manager.password);
    const all = (await call<{ total: number; items: { status: string; issue_date: string | null }[] }>("GET", "/api/v1/manager/invoices?page_size=100", { token })).body;
    expect(all.total).toBe(data.invoices.length);
    const firstDated = all.items.findIndex((i) => i.issue_date !== null);
    expect(all.items.slice(0, firstDated).every((i) => i.status === "draft")).toBe(true);
    const paid = (await call<{ total: number; items: { status: string; balance_pence: number }[] }>("GET", "/api/v1/manager/invoices?status=paid", { token })).body;
    expect(paid.items.every((i) => i.status === "paid" && i.balance_pence === 0)).toBe(true);
    expect((await call("GET", "/api/v1/manager/invoices?status=bogus", { token })).status).toBe(422);
  });

  it("lists painters by name", async () => {
    const { call, signIn } = setup();
    const token = await signIn(manager.email, manager.password);
    const p = (await call<{ name: string }[]>("GET", "/api/v1/manager/painters", { token })).body;
    expect(p).toHaveLength(data.users.filter((u) => u.role === "painter").length);
    expect(p.map((x) => x.name)).toEqual([...p.map((x) => x.name)].sort());
  });
});

describe("mock API: report writes", () => {
  async function awaitingReport() {
    const s = setup();
    const token = await s.signIn(manager.email, manager.password);
    const item = (await s.call<ReportPage>("GET", "/api/v1/manager/reports?review_status=awaiting_review", { token })).body.items[0]!;
    const report = (await s.call<ReportDetail>("GET", `/api/v1/manager/reports/${item.id}`, { token })).body;
    return { ...s, token, report };
  }

  it("marks a report reviewed, bumps the version and records history", async () => {
    const { call, token, report } = await awaitingReport();
    const r = await call<ReportDetail>("POST", `/api/v1/manager/reports/${report.id}/review`, { token, body: { version: report.version } });
    expect(r.status).toBe(200);
    expect(r.body.review_status).toBe("reviewed");
    expect(r.body.version).toBe(report.version + 1);
    expect(r.body.reviewed_by?.name).toBe(manager.full_name);
    expect(r.body.reviewed_at).toBe("2026-11-20T10:00:00Z");
    const h = (await call<AuditHistory>("GET", `/api/v1/manager/reports/${report.id}/history`, { token })).body;
    expect(h.total).toBe(1);
    expect(h.items[0]).toMatchObject({ action: "report.reviewed" });
    expect(h.items[0]!.changes[0]).toMatchObject({ field: "review_status", old_value: "awaiting_review", new_value: "reviewed" });
    const dash = (await call<Dashboard>("GET", "/api/v1/manager/dashboard", { token })).body;
    expect(dash.review_queue.map((q) => q.id)).not.toContain(report.id);
  });

  it("answers 409 version_conflict for a stale version and already_reviewed for a repeat", async () => {
    const { call, token, report } = await awaitingReport();
    const stale = await call<{ code: string; current_version: number }>("POST", `/api/v1/manager/reports/${report.id}/review`, { token, body: { version: report.version + 5 } });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("version_conflict");
    expect(stale.body.current_version).toBe(report.version);
    await call("POST", `/api/v1/manager/reports/${report.id}/review`, { token, body: { version: report.version } });
    const again = await call<{ code: string; reviewed_by: { name: string } }>("POST", `/api/v1/manager/reports/${report.id}/review`, { token, body: { version: report.version + 1 } });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("already_reviewed");
    expect(again.body.reviewed_by.name).toBe(manager.full_name);
    expect((await call("POST", `/api/v1/manager/reports/${report.id}/review`, { token, body: {} })).status).toBe(422);
  });

  it("edits notes and checklist, blank notes become null, a no-op changes nothing", async () => {
    const { call, token, report } = await awaitingReport();
    const item = report.checklist[0]!;
    const r = await call<ReportDetail>("PATCH", `/api/v1/manager/reports/${report.id}`, {
      token,
      body: { version: report.version, manager_notes: "Checked photos.", painter_notes: "   ", checklist: [{ id: item.id, done: !item.done, note: "Looked at it" }] },
    });
    expect(r.status).toBe(200);
    expect(r.body.version).toBe(report.version + 1);
    expect(r.body.manager_notes).toBe("Checked photos.");
    expect(r.body.painter_notes).toBeNull();
    expect(r.body.checklist[0]).toMatchObject({ done: !item.done, note: "Looked at it" });
    expect(r.body.last_changed_by?.name).toBe(manager.full_name);

    const same = await call<ReportDetail>("PATCH", `/api/v1/manager/reports/${report.id}`, { token, body: { version: r.body.version, manager_notes: "Checked photos." } });
    expect(same.status).toBe(200);
    expect(same.body.version).toBe(r.body.version);
    const h = (await call<AuditHistory>("GET", `/api/v1/manager/reports/${report.id}/history`, { token })).body;
    expect(h.total).toBe(1);
    expect(h.items[0]!.changes.map((c) => c.field).sort()).toEqual(["checklist_done", "checklist_note", "manager_notes", "painter_notes"].filter((f) => report.painter_notes !== null || f !== "painter_notes").sort());
  });

  it("returns 409 with the current values so Apply my changes on top can merge, and the retry then saves", async () => {
    const a = await awaitingReport();
    const { call, token, report } = a;
    // Someone else saves first.
    await call("PATCH", `/api/v1/manager/reports/${report.id}`, { token, body: { version: report.version, manager_notes: "Their note" } });
    const mine = { version: report.version, manager_notes: "My note", checklist: [{ id: report.checklist[0]!.id, done: !report.checklist[0]!.done }] };
    const conflict = await call<Record<string, unknown>>("PATCH", `/api/v1/manager/reports/${report.id}`, { token, body: mine });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ code: "version_conflict", current_version: report.version + 1, current: { manager_notes: "Their note" } });

    // The shared client turns this into the conflict the web app merges.
    const parsed = parseConflict(toApiError(conflict.body, 409, null));
    expect(parsed?.currentVersion).toBe(report.version + 1);

    const retry = await call<ReportDetail>("PATCH", `/api/v1/manager/reports/${report.id}`, { token, body: { ...mine, version: report.version + 1 } });
    expect(retry.status).toBe(200);
    expect(retry.body.manager_notes).toBe("My note");
    expect(retry.body.version).toBe(report.version + 2);
  });

  it("reopens a reviewed report when it is edited", async () => {
    const { call, token, report } = await awaitingReport();
    const reviewed = (await call<ReportDetail>("POST", `/api/v1/manager/reports/${report.id}/review`, { token, body: { version: report.version } })).body;
    const edited = (await call<ReportDetail>("PATCH", `/api/v1/manager/reports/${report.id}`, { token, body: { version: reviewed.version, manager_notes: "Second thoughts" } })).body;
    expect(edited.review_status).toBe("awaiting_review");
    expect(edited.reviewed_at).toBeNull();
    expect(edited.reviewed_by).toBeNull();
    const h = (await call<AuditHistory>("GET", `/api/v1/manager/reports/${report.id}/history`, { token })).body;
    expect(h.items.map((e) => e.action)).toEqual(["report.reopened", "report.edited", "report.reviewed"]);
  });

  it("rejects bad bodies: unknown keys, foreign checklist ids, duplicates, long notes, no fields", async () => {
    const { call, token, report } = await awaitingReport();
    const patch = (body: unknown) => call<{ errors: { loc: (string | number)[] }[] }>("PATCH", `/api/v1/manager/reports/${report.id}`, { token, body });
    expect((await patch({ version: 1, photos: [] })).status).toBe(422);
    expect((await patch({ version: 1 })).status).toBe(422);
    expect((await patch({ version: 1, manager_notes: "x".repeat(5001) })).status).toBe(422);
    const foreign = await patch({ version: 1, checklist: [{ id: "00000000-0000-4000-8000-000000000000", done: true }] });
    expect(foreign.status).toBe(422);
    expect(foreign.body.errors[0]!.loc).toEqual(["body", "checklist", 0, "id"]);
    const id = report.checklist[0]!.id;
    expect((await patch({ version: 1, checklist: [{ id, done: true }, { id, done: false }] })).status).toBe(422);
    expect((await patch({ version: 1, checklist: [{ id }] })).status).toBe(422);
  });

  it("keeps state in memory per backend: a new backend starts from the seed", async () => {
    const first = await awaitingReport();
    await first.call("POST", `/api/v1/manager/reports/${first.report.id}/review`, { token: first.token, body: { version: first.report.version } });
    const fresh = await awaitingReport();
    expect(fresh.report.id).toBe(first.report.id);
    expect(fresh.report.review_status).toBe("awaiting_review");
    expect(fresh.report.version).toBe(1);
  });
});

describe("mock API: customers", () => {
  async function customer() {
    const s = setup();
    const token = await s.signIn(manager.email, manager.password);
    const item = (await s.call<ReportPage>("GET", "/api/v1/manager/reports", { token })).body.items[0]!;
    const record = (await s.call<CustomerRecord>("GET", `/api/v1/manager/customers/${item.customer.id}`, { token })).body;
    return { ...s, token, record, reportId: item.id };
  }

  it("returns the record with its impact counts", async () => {
    const { record } = await customer();
    expect(record.version).toBe(1);
    expect(record.impact.job_count).toBeGreaterThanOrEqual(record.impact.report_count);
    expect(record.impact.report_count).toBeGreaterThan(0);
  });

  it("edits details, normalises the postcode, and shows the change in customer and report history", async () => {
    const { call, token, record, reportId } = await customer();
    const r = await call<CustomerRecord>("PATCH", `/api/v1/manager/customers/${record.id}`, {
      token,
      body: { version: record.version, email: "  new.name@example.co.uk ", billing_address: { postcode: "bs65qa" } },
    });
    expect(r.status).toBe(200);
    expect(r.body.version).toBe(2);
    expect(r.body.email).toBe("new.name@example.co.uk");
    expect(r.body.billing_address.postcode).toBe("BS6 5QA");
    expect(r.body.last_changed_by?.name).toBe(manager.full_name);
    const ch = (await call<AuditHistory>("GET", `/api/v1/manager/customers/${record.id}/history`, { token })).body;
    expect(ch.total).toBe(1);
    expect(ch.items[0]!.changes.map((c) => c.field).sort()).toEqual(["customer_billing_postcode", "customer_email"]);
    const rh = (await call<AuditHistory>("GET", `/api/v1/manager/reports/${reportId}/history`, { token })).body;
    expect(rh.items.map((e) => e.action)).toContain("customer.edited");
    const detail = (await call<ReportDetail>("GET", `/api/v1/manager/reports/${reportId}`, { token })).body;
    expect(detail.customer.email).toBe("new.name@example.co.uk");
    // a no-op leaves the version alone
    const same = await call<CustomerRecord>("PATCH", `/api/v1/manager/customers/${record.id}`, { token, body: { version: 2, email: "new.name@example.co.uk" } });
    expect(same.body.version).toBe(2);
  });

  it("answers 409 with the current values on a stale version", async () => {
    const { call, token, record } = await customer();
    await call("PATCH", `/api/v1/manager/customers/${record.id}`, { token, body: { version: 1, phone: "07700 900123" } });
    const stale = await call<{ code: string; current_version: number; current: { phone: string } }>("PATCH", `/api/v1/manager/customers/${record.id}`, {
      token,
      body: { version: 1, phone: "07700 900456" },
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: "version_conflict", current_version: 2, current: { phone: "07700 900123" } });
  });

  it("validates fields like the contract: required, formats, unknown keys", async () => {
    const { call, token, record } = await customer();
    const patch = (body: unknown) => call<{ errors: { loc: string[]; message: string }[] }>("PATCH", `/api/v1/manager/customers/${record.id}`, { token, body });
    expect((await patch({ version: 1, name: "  " })).status).toBe(422);
    expect((await patch({ version: 1, email: "not-an-email" })).status).toBe(422);
    expect((await patch({ version: 1, phone: "12345" })).status).toBe(422);
    expect((await patch({ version: 1, billing_address: { postcode: "ZZZ" } })).status).toBe(422);
    const extra = await patch({ version: 1, payment_terms_days: 5 });
    expect(extra.status).toBe(422);
    expect(extra.body.errors[0]!.loc).toEqual(["body", "payment_terms_days"]);
    expect((await call("PATCH", "/api/v1/manager/customers/00000000-0000-4000-8000-000000000000", { token, body: { version: 1, name: "X" } })).status).toBe(404);
  });
});

describe("mock API: admin settings", () => {
  it("reads, updates, reflects in branding and records history", async () => {
    const { call, signIn } = setup();
    const token = await signIn(admin.email, admin.password);
    const before = (await call<{ updated_at: string | null }>("GET", "/api/v1/admin/settings", { token })).body;
    expect(before.updated_at).toBeNull();
    const r = await call<{ company_name: string; theme: { primary: string }; updated_by: { name: string } }>("PATCH", "/api/v1/admin/settings", {
      token,
      body: { company_name: "  Harbour Decorators ", theme: { primary: "#1f3a8a", accent: "#7c2d12" } },
    });
    expect(r.status).toBe(200);
    expect(r.body.company_name).toBe("Harbour Decorators");
    expect(r.body.theme.primary).toBe("#1F3A8A");
    expect(r.body.updated_by.name).toBe(admin.full_name);
    const branding = (await call<{ company_name: string }>("GET", "/api/v1/branding")).body;
    expect(branding.company_name).toBe("Harbour Decorators");
    const h = (await call<AuditHistory>("GET", "/api/v1/admin/settings/history", { token })).body;
    expect(h.total).toBe(1);
    expect(h.items[0]!.changes.map((c) => c.field).sort()).toEqual(["company_name", "theme_accent", "theme_primary"]);
    const same = await call("PATCH", "/api/v1/admin/settings", { token, body: { company_name: "Harbour Decorators" } });
    expect(same.status).toBe(200);
    expect((await call<AuditHistory>("GET", "/api/v1/admin/settings/history", { token })).body.total).toBe(1);
  });

  it("rejects low contrast with the measured ratios, and bad names and colours", async () => {
    const { call, signIn } = setup();
    const token = await signIn(admin.email, admin.password);
    const low = await call<{ code: string; errors: { loc: string[]; measured_ratio: number; required_ratio: number }[] }>("PATCH", "/api/v1/admin/settings", {
      token,
      body: { theme: { primary: "#FFFF00", accent: "#1F5130" } },
    });
    expect(low.status).toBe(422);
    expect(low.body.code).toBe("contrast_too_low");
    expect(low.body.errors).toHaveLength(1);
    expect(low.body.errors[0]).toMatchObject({ loc: ["body", "theme", "primary"], required_ratio: 4.5 });
    expect(low.body.errors[0]!.measured_ratio).toBeLessThan(4.5);
    expect((await call("PATCH", "/api/v1/admin/settings", { token, body: { company_name: "" } })).status).toBe(422);
    expect((await call("PATCH", "/api/v1/admin/settings", { token, body: { theme: { primary: "red", accent: "#1F5130" } } })).status).toBe(422);
    expect((await call("PATCH", "/api/v1/admin/settings", { token, body: { surprise: 1 } })).status).toBe(422);
  });
});

describe("mock API: misc", () => {
  it("answers unknown paths with 404 problem+json and failed calls surface as ApiError", async () => {
    const { call, signIn } = setup();
    const token = await signIn(manager.email, manager.password);
    const r = await call<{ code: string }>("GET", "/api/v1/manager/nope", { token });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe("not_found");
    expect(toApiError(r.body, 404, null)).toBeInstanceOf(ApiError);
  });

  it("uses only data, no URL that leaves the page", () => {
    const text = JSON.stringify(mockData);
    expect(text).not.toMatch(/https?:\/\//);
  });
});
