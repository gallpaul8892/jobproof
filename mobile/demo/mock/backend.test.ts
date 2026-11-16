import data from "./operativeData.json";
import { ACCESS_TTL_SECONDS, MockProblem, OperativeBackend } from "./backend";
import type { OperativeMockData } from "./data";

const D = data as unknown as OperativeMockData;
const DEVICE = "6f1b6d0c-0000-4000-8000-000000000001";
const login = { email: D.account.email, password: D.account.password, device_id: DEVICE, platform: "android", app_version: "0.1.0" };

let clock = new Date("2027-03-01T10:00:00Z");
const make = () => new OperativeBackend(D, { now: () => clock });
const bearer = (access: string) => `Bearer ${access}`;
const fails = (fn: () => unknown, status: number, code: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(MockProblem);
    expect({ status: (e as MockProblem).status, code: (e as MockProblem).code }).toEqual({ status, code });
    return e as MockProblem;
  }
  throw new Error(`expected ${status} ${code}`);
};

beforeEach(() => {
  clock = new Date("2027-03-01T10:00:00Z");
});

describe("demo data", () => {
  it("is only the demo operative's: no password hashes, no money, no manager notes, no other people's jobs", () => {
    const text = JSON.stringify(D);
    expect(text).not.toMatch(/hash|argon|bcrypt|manager_notes|total_pence|invoice/i);
    expect(D.jobs.length).toBeGreaterThan(5);
    expect(new Set(D.jobs.map((j) => j.reference)).size).toBe(D.jobs.length);
    expect(D.account.user.role).toBe("painter");
  });
});

describe("sessions", () => {
  it("only the published demo operative signs in", () => {
    const api = make();
    const session = api.createSession(login);
    expect(session).toMatchObject({ token_type: "bearer", expires_in: ACCESS_TTL_SECONDS, user: { email: D.account.email, role: "painter" } });
    expect(session.refresh_token.length).toBeGreaterThanOrEqual(20);
    fails(() => api.createSession({ ...login, password: "wrong" }), 401, "invalid_credentials");
    fails(() => api.createSession({ ...login, email: "manager@jobproof.test", password: "Manager123!" }), 401, "invalid_credentials");
    expect(api.createSession({ ...login, email: ` ${D.account.email.toUpperCase()} ` }).user.id).toBe(D.account.user.id);
  });

  it("validates the sign-in body like the real server", () => {
    const e = fails(() => make().createSession({ email: "a", password: "", device_id: "nope", platform: "windows", app_version: "x" }), 422, "validation_error");
    expect(e.errors!.map((x) => x.loc[1])).toEqual(["email", "password", "device_id", "platform", "app_version"]);
  });

  it("a refresh token is single use; the previous one is forgiven for 60 seconds, then the session is revoked", () => {
    const api = make();
    const first = api.createSession(login);
    const second = api.refreshSession({ refresh_token: first.refresh_token });
    expect(second.refresh_token).not.toBe(first.refresh_token);
    // A lost response: the old token again, straight away.
    const third = api.refreshSession({ refresh_token: first.refresh_token });
    expect(third.refresh_token).not.toBe(second.refresh_token);
    clock = new Date(clock.getTime() + 61_000);
    fails(() => api.refreshSession({ refresh_token: first.refresh_token }), 401, "session_ended");
    fails(() => api.authenticate(bearer(third.access_token)), 401, "unauthenticated"); // reuse revoked the whole session
    fails(() => api.refreshSession({ refresh_token: third.refresh_token }), 401, "session_ended");
    fails(() => api.refreshSession({ refresh_token: "x".repeat(30) }), 401, "session_ended");
    fails(() => api.refreshSession({ refresh_token: "short" }), 422, "validation_error");
  });

  it("an access token expires after 15 minutes", () => {
    const api = make();
    const s = api.createSession(login);
    expect(api.authenticate(bearer(s.access_token)).user.id).toBe(D.account.user.id);
    clock = new Date(clock.getTime() + ACCESS_TTL_SECONDS * 1000 + 1);
    fails(() => api.authenticate(bearer(s.access_token)), 401, "unauthenticated");
    fails(() => api.authenticate(null), 401, "unauthenticated");
  });

  it("signing in again on the same device ends the old session; sign-out ends the current one", () => {
    const api = make();
    const a = api.createSession(login);
    const b = api.createSession(login);
    fails(() => api.authenticate(bearer(a.access_token)), 401, "unauthenticated");
    api.endSession(bearer(b.access_token));
    fails(() => api.authenticate(bearer(b.access_token)), 401, "unauthenticated");
    fails(() => api.refreshSession({ refresh_token: b.refresh_token }), 401, "session_ended");
  });
});

describe("jobs", () => {
  it("moves the data's dates so its 'today' is the visitor's today in London", () => {
    const api = make();
    expect(api.today()).toBe("2027-03-01");
    const list = api.listJobs();
    expect(list.today).toBe("2027-03-01");
    expect(list.jobs_today.map((j) => j.scheduled_start)).toEqual(["2027-03-01", "2027-03-01", "2027-03-01"]);
    expect(list.jobs_today.map((j) => j.reference)).toEqual(["JP-1061", "JP-1062", "JP-1063"]);
    expect(list.earlier_unfinished.map((j) => [j.reference, j.scheduled_start, j.status])).toEqual([["JP-1064", "2027-02-28", "in_progress"]]);
    expect(new Date(list.as_of).getTime()).toBe(clock.getTime());
  });

  it("uses London's calendar day, not UTC's, near midnight", () => {
    clock = new Date("2027-06-30T23:30:00Z"); // 00:30 on 1 July in London
    expect(make().today()).toBe("2027-07-01");
  });

  it("an earlier job more than 30 days old drops off the list (finished ones never show)", () => {
    const old = structuredClone(D);
    const open = old.jobs.find((j) => j.reference === "JP-1064")!;
    open.scheduled_start = "2026-10-10"; // 36 days before the data's own today
    const list = new OperativeBackend(old, { now: () => new Date("2026-11-15T12:00:00Z") }).listJobs();
    expect(list.earlier_unfinished).toEqual([]);
    open.scheduled_start = "2026-10-20"; // 26 days before
    expect(new OperativeBackend(old, { now: () => new Date("2026-11-15T12:00:00Z") }).listJobs().earlier_unfinished.map((j) => j.reference)).toEqual(["JP-1064"]);
  });

  it("gives the full job with checklist, contact and report; leaves out the demo's bookkeeping", () => {
    const api = make();
    const id = api.listJobs().jobs_today[0]!.id;
    const job = api.getJob(id) as unknown as Record<string, unknown>;
    expect(Object.keys(job)).not.toContain("_job_status");
    expect(job).toMatchObject({ reference: "JP-1061", status: "to_do", checklist_total: 9, checklist_dealt_with: 0, report: null });
    expect(api.getJob(id.toUpperCase()).id).toBe(id); // ids are case-insensitive UUIDs
  });

  it("an unknown or malformed job is a 404, never a hint", () => {
    const api = make();
    fails(() => api.getJob("00000000-0000-4000-8000-000000000000"), 404, "not_found");
    fails(() => api.getJob("not-a-uuid"), 404, "not_found");
  });
});

describe("saving the draft report", () => {
  const todo = (api: OperativeBackend) => api.listJobs().jobs_today[0]!;

  it("creates the draft on first write, starts the job and counts dealt-with items", () => {
    const api = make();
    const job = todo(api);
    const [a, b] = job.checklist;
    const saved = api.saveDraft(job.id, {
      notes: "Two coats on the lounge.",
      checklist: [
        { item_id: a!.id, status: "done" },
        { item_id: b!.id, status: "not_done" }, // no reason yet: not counted
      ],
    });
    expect(saved.status).toBe("in_progress");
    expect(saved.report).toMatchObject({ state: "draft", notes: "Two coats on the lounge." });
    expect(saved.checklist_dealt_with).toBe(1);
    const again = api.saveDraft(job.id, { checklist: [{ item_id: b!.id, note: "Customer away" }] });
    expect(again.checklist_dealt_with).toBe(2);
    expect(api.getJob(job.id).report!.notes).toBe("Two coats on the lounge.");
    expect(api.saveDraft(job.id, { notes: "  " }).report!.notes).toBeNull(); // blank clears
  });

  it("the draft is also what the list shows afterwards", () => {
    const api = make();
    const job = todo(api);
    api.saveDraft(job.id, { notes: "x" });
    expect(api.listJobs().jobs_today.find((j) => j.id === job.id)!.status).toBe("in_progress");
  });

  it("refuses bad bodies with field errors", () => {
    const api = make();
    const job = todo(api);
    fails(() => api.saveDraft(job.id, {}), 422, "validation_error");
    fails(() => api.saveDraft(job.id, { extra: 1 }), 422, "validation_error");
    fails(() => api.saveDraft(job.id, { notes: "x".repeat(2001) }), 422, "validation_error");
    fails(() => api.saveDraft(job.id, { checklist: [] }), 422, "validation_error");
    fails(() => api.saveDraft(job.id, { checklist: [{ item_id: "00000000-0000-4000-8000-000000000009", status: "done" }] }), 422, "validation_error");
    fails(() => api.saveDraft(job.id, { checklist: [{ item_id: job.checklist[0]!.id }] }), 422, "validation_error");
    fails(() => api.saveDraft(job.id, { checklist: [{ item_id: job.checklist[0]!.id, status: "maybe" }] }), 422, "validation_error");
    fails(() => api.saveDraft(job.id, { checklist: [{ item_id: job.checklist[0]!.id, status: "done" }, { item_id: job.checklist[0]!.id, status: "open" }] }), 422, "validation_error");
    fails(() => api.saveDraft(job.id, null), 422, "validation_error");
  });

  it("refuses a submitted report with 409 report_submitted", () => {
    const api = make();
    const submitted = D.jobs.find((j) => j.report?.state === "submitted")!;
    // Its date is long past, so ask for it by id (detail works for any date).
    const problem = fails(() => api.saveDraft(submitted.id, { notes: "late" }), 409, "report_submitted");
    expect(problem.extra.submitted_at).toBeTruthy();
  });
});
