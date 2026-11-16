import { londonDateOf } from "@jobproof/shared";
import type { AppStatus, Branding, DeviceSession, OperativeJob, OperativeJobList, OperativeReport, User } from "@jobproof/shared";
import type { DemoJob, OperativeMockData } from "./data";

/** Mirrors backend/app/services/operative_jobs.py: 30 days back, 50 rows. */
export const EARLIER_DAYS = 30;
export const EARLIER_LIMIT = 50;
export const ACCESS_TTL_SECONDS = 900;
export const API_VERSION = "0.6.0";

export class MockProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    title: string,
    readonly errors?: { loc: (string | number)[]; message: string }[],
    readonly extra: Record<string, unknown> = {},
  ) {
    super(title);
  }
}

const DAY_MS = 86_400_000;
const dayNumber = (isoDate: string) => Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / DAY_MS);
const addDays = (isoDate: string, days: number) => new Date((dayNumber(isoDate) + days) * DAY_MS).toISOString().slice(0, 10);

interface Session {
  id: string;
  deviceId: string;
  currentRefresh: string;
  /** The token that was replaced last, and when: the real server tolerates a lost response for 60 s. */
  previousRefresh?: { token: string; at: number };
  /** Every token already replaced: using one of these again means the token was stolen. */
  spent: Set<string>;
  revoked: boolean;
}

export interface BackendOptions {
  /** The visitor's clock; injectable for tests. */
  now?: () => Date;
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEMVER = /^\d+\.\d+\.\d+$/;
const NOTES_MAX = 2000;
const ITEM_NOTE_MAX = 500;
// eslint-disable-next-line no-control-regex
const UNSTORABLE = /[\u0000\ud800-\udfff]/;

let counter = 0;
const token = (prefix: string) => `${prefix}.${Date.now().toString(36)}${(++counter).toString(36)}.${Math.random().toString(36).slice(2, 12)}`;
const uuid = () => globalThis.crypto.randomUUID();

/**
 * The operative API, answered in memory. One published demo account signs in; everything else is
 * refused the way the real server refuses it. Dates in the exported data are shifted so that its
 * "today" is the visitor's today in London. Writes (the draft report) change only this object and
 * are gone on reload.
 */
export class OperativeBackend {
  private readonly jobs: DemoJob[];
  private readonly sessions = new Map<string, Session>();
  private readonly accessTokens = new Map<string, { sessionId: string; expiresAt: number }>();
  private readonly now: () => Date;
  readonly shiftDays: number;

  constructor(private readonly data: OperativeMockData, options: BackendOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.shiftDays = dayNumber(this.today()) - dayNumber(data.anchor);
    this.jobs = data.jobs.map((job) => this.shift(structuredClone(job)));
  }

  today(): string {
    return londonDateOf(this.now());
  }

  private shift(job: DemoJob): DemoJob {
    job.scheduled_start = addDays(job.scheduled_start, this.shiftDays);
    const r = job.report;
    if (r) {
      const move = (iso: string | null) => (iso ? new Date(Date.parse(iso) + this.shiftDays * DAY_MS).toISOString() : iso);
      r.submitted_at = move(r.submitted_at);
      r.reviewed_at = move(r.reviewed_at);
    }
    return job;
  }

  // ---- public ----------------------------------------------------------------------------------
  branding(): Branding {
    return this.data.branding;
  }

  appStatus(): AppStatus {
    return { server_time: this.now().toISOString(), api_version: API_VERSION, min_supported_versions: { android: "0.0.0" } };
  }

  // ---- sessions --------------------------------------------------------------------------------
  createSession(body: unknown): DeviceSession {
    const b = (body ?? {}) as Record<string, unknown>;
    const errors: { loc: (string | number)[]; message: string }[] = [];
    if (typeof b.email !== "string" || b.email.length < 3) errors.push({ loc: ["body", "email"], message: "Enter an email address." });
    if (typeof b.password !== "string" || b.password.length < 1) errors.push({ loc: ["body", "password"], message: "Enter a password." });
    if (typeof b.device_id !== "string" || !ID.test(b.device_id)) errors.push({ loc: ["body", "device_id"], message: "Input should be a valid UUID." });
    if (b.platform !== "android" && b.platform !== "ios") errors.push({ loc: ["body", "platform"], message: "Input should be 'android' or 'ios'." });
    if (typeof b.app_version !== "string" || !SEMVER.test(b.app_version)) errors.push({ loc: ["body", "app_version"], message: "Input should be a version such as 1.2.3." });
    if (errors.length > 0) throw new MockProblem(422, "validation_error", "Request validation failed.", errors);
    const { email, password, device_id } = b as { email: string; password: string; device_id: string };
    const account = this.data.account;
    if (email.trim().toLowerCase() !== account.email.toLowerCase() || password !== account.password) {
      throw new MockProblem(401, "invalid_credentials", "Wrong email or password.");
    }
    // A new session for the same device ends that device's previous one.
    for (const s of this.sessions.values()) if (s.deviceId === device_id) s.revoked = true;
    return this.issue({ id: uuid(), deviceId: device_id, currentRefresh: "", spent: new Set(), revoked: false });
  }

  refreshSession(body: unknown): DeviceSession {
    const t = (body as { refresh_token?: unknown } | null)?.refresh_token;
    if (typeof t !== "string" || t.length < 20 || t.length > 200) {
      throw new MockProblem(422, "validation_error", "Request validation failed.", [{ loc: ["body", "refresh_token"], message: "String should have at least 20 characters." }]);
    }
    const session = [...this.sessions.values()].find((s) => s.currentRefresh === t || s.previousRefresh?.token === t || s.spent.has(t));
    const ended = () => new MockProblem(401, "session_ended", "This session has ended. Sign in again.");
    if (!session || session.revoked) throw ended();
    if (session.currentRefresh !== t) {
      // The previous token: a lost response within 60 s is forgiven; any other old token is theft.
      const forgiven = session.previousRefresh?.token === t && this.now().getTime() - session.previousRefresh.at <= 60_000;
      if (!forgiven) {
        session.revoked = true;
        throw ended();
      }
    }
    return this.issue(session);
  }

  private issue(session: Session): DeviceSession {
    if (session.previousRefresh) session.spent.add(session.previousRefresh.token);
    if (session.currentRefresh) session.previousRefresh = { token: session.currentRefresh, at: this.now().getTime() };
    session.currentRefresh = token("demo-refresh");
    this.sessions.set(session.id, session);
    const access = token("demo-access");
    this.accessTokens.set(access, { sessionId: session.id, expiresAt: this.now().getTime() + ACCESS_TTL_SECONDS * 1000 });
    return {
      access_token: access,
      token_type: "bearer",
      expires_in: ACCESS_TTL_SECONDS,
      refresh_token: session.currentRefresh,
      refresh_expires_at: new Date(this.now().getTime() + 30 * DAY_MS).toISOString(),
      session_id: session.id,
      user: this.data.account.user,
    };
  }

  /** The signed-in user for a bearer token, or a 401 the app answers by refreshing. */
  authenticate(header: string | null): { user: User; session: Session } {
    const m = /^Bearer (.+)$/.exec(header ?? "");
    const entry = m ? this.accessTokens.get(m[1]!) : undefined;
    const session = entry ? this.sessions.get(entry.sessionId) : undefined;
    if (!entry || !session || session.revoked || entry.expiresAt <= this.now().getTime()) {
      throw new MockProblem(401, "unauthenticated", "Sign in to continue.");
    }
    return { user: this.data.account.user, session };
  }

  endSession(header: string | null): void {
    this.authenticate(header).session.revoked = true;
  }

  // ---- jobs ------------------------------------------------------------------------------------
  private strip(job: DemoJob): OperativeJob {
    const { _job_status, _job_items, ...api } = job;
    void _job_status;
    void _job_items;
    return structuredClone(api);
  }

  listJobs(): OperativeJobList {
    const today = this.today();
    const floor = addDays(today, -EARLIER_DAYS);
    const rank = (j: DemoJob) => (j.status === "in_progress" || j.status === "to_do" ? 0 : j.status === "submitted" ? 1 : j.status === "completed_by_office" ? 2 : 3);
    const todays = this.jobs
      .filter((j) => j.scheduled_start === today)
      .sort((a, b) => rank(a) - rank(b) || a.reference.localeCompare(b.reference));
    const earlier = this.jobs
      .filter(
        (j) =>
          j.scheduled_start < today &&
          j.scheduled_start >= floor &&
          j._job_status !== "completed" &&
          j._job_status !== "cancelled" &&
          j.report?.state !== "submitted",
      )
      .sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start) || a.reference.localeCompare(b.reference))
      .slice(0, EARLIER_LIMIT);
    return {
      as_of: this.now().toISOString(),
      today,
      jobs_today: todays.map((j) => this.strip(j)),
      earlier_unfinished: earlier.map((j) => this.strip(j)),
    };
  }

  private own(id: string): DemoJob {
    const job = ID.test(id) ? this.jobs.find((j) => j.id === id.toLowerCase()) : undefined;
    if (!job) throw new MockProblem(404, "not_found", "Job not found.");
    return job;
  }

  getJob(id: string): OperativeJob {
    return this.strip(this.own(id));
  }

  /** PATCH /operative/jobs/{id}/report: same rules as backend/app/services/drafts.py and schemas/operative.py. */
  saveDraft(id: string, body: unknown): OperativeJob {
    const job = this.own(id);
    const b = body as { notes?: unknown; checklist?: unknown } | null;
    const errors: { loc: (string | number)[]; message: string }[] = [];
    if (typeof b !== "object" || b === null || Array.isArray(b)) throw new MockProblem(422, "validation_error", "Request validation failed.", [{ loc: ["body"], message: "Input should be an object." }]);
    for (const key of Object.keys(b)) if (key !== "notes" && key !== "checklist") errors.push({ loc: ["body", key], message: "Extra inputs are not permitted." });
    const hasNotes = "notes" in b;
    const hasList = "checklist" in b;
    if (!hasNotes && !hasList && errors.length === 0) errors.push({ loc: ["body"], message: "Send at least one field to change." });
    if (hasNotes && b.notes !== null && (typeof b.notes !== "string" || b.notes.length > NOTES_MAX || UNSTORABLE.test(b.notes))) {
      errors.push({ loc: ["body", "notes"], message: `Notes must be text of at most ${NOTES_MAX} characters.` });
    }
    type Update = { item_id: string; status?: "open" | "done" | "not_done"; note?: string | null };
    let updates: Update[] = [];
    if (hasList) {
      const list = b.checklist;
      if (!Array.isArray(list) || list.length < 1 || list.length > 200) errors.push({ loc: ["body", "checklist"], message: "Send a list of 1 to 200 checklist items." });
      else {
        const seen = new Set<string>();
        list.forEach((raw: unknown, i) => {
          const u = (raw ?? {}) as Record<string, unknown>;
          const at = (f: string) => ["body", "checklist", i, f];
          if (typeof u.item_id !== "string" || !ID.test(u.item_id)) errors.push({ loc: at("item_id"), message: "Input should be a valid UUID." });
          else if (seen.has(u.item_id.toLowerCase())) errors.push({ loc: at("item_id"), message: "Each checklist item may be sent once." });
          else if (!job._job_items.includes(u.item_id.toLowerCase())) errors.push({ loc: at("item_id"), message: "Checklist item does not belong to this job." });
          else seen.add(u.item_id.toLowerCase());
          if ("status" in u && !["open", "done", "not_done"].includes(u.status as string)) errors.push({ loc: at("status"), message: "Use open, done or not_done." });
          if ("note" in u && u.note !== null && (typeof u.note !== "string" || u.note.length > ITEM_NOTE_MAX || UNSTORABLE.test(u.note))) errors.push({ loc: at("note"), message: `Notes must be at most ${ITEM_NOTE_MAX} characters.` });
          if (!("status" in u) && !("note" in u)) errors.push({ loc: ["body", "checklist", i], message: "Send status, note or both." });
        });
        updates = list as Update[];
      }
    }
    if (errors.length > 0) throw new MockProblem(422, "validation_error", "Request validation failed.", errors);

    if (job.status === "cancelled") throw new MockProblem(409, "job_cancelled", "This job was cancelled by the office.");
    if (job._job_status === "completed" && job.report?.state !== "submitted") throw new MockProblem(409, "job_closed", "This job was closed by the office.");
    if (job.report?.state === "submitted") throw new MockProblem(409, "report_submitted", "This report has already been submitted.", undefined, { submitted_at: job.report.submitted_at });

    // Only the fields the server sends today: photos, sign-off and submission ids arrive with T-003g/h.
    const report: OperativeReport = job.report ?? ({ id: uuid(), state: "draft", notes: null, submitted_at: null, submitted_by: null, review_status: null, reviewed_at: null, reviewed_by: null } as unknown as OperativeReport);
    job.report = report;
    if (job.status === "to_do") job.status = "in_progress";
    if (hasNotes) report.notes = typeof b.notes === "string" && b.notes.trim() !== "" ? b.notes : null;
    for (const u of updates) {
      const item = job.checklist.find((i) => i.id === u.item_id.toLowerCase());
      if (!item) continue;
      if (u.status !== undefined) item.status = u.status;
      if ("note" in u) item.note = typeof u.note === "string" && u.note.trim() !== "" ? u.note : null;
    }
    const live = job.checklist.filter((i) => !i.removed);
    job.checklist_dealt_with = live.filter((i) => i.status === "done" || (i.status === "not_done" && (i.note ?? "").trim() !== "")).length;
    return this.strip(job);
  }
}
