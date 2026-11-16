import data from "./operativeData.json";
import { ACCESS_TTL_SECONDS, MockProblem, OperativeBackend } from "./backend";
import { loginsOf, type OperativeMockData } from "./data";

const D = data as unknown as OperativeMockData;
const DEVICE = "6f1b6d0c-0000-4000-8000-000000000001";
const DAN = D.accounts[0]!;
const PRIYA = D.accounts[1]!;
const TOM = D.accounts[2]!;
const login = { email: DAN.email, password: DAN.password, device_id: DEVICE, platform: "android", app_version: "0.1.0" };

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

const sessions = new WeakMap<OperativeBackend, Map<string, string>>();
/** A bearer header for `account` on this backend (signed in once, then reused). */
const as = (api: OperativeBackend, account = DAN) => {
  const mine = sessions.get(api) ?? new Map<string, string>();
  sessions.set(api, mine);
  if (!mine.has(account.email)) mine.set(account.email, bearer(api.createSession({ ...login, email: account.email, password: account.password, device_id: crypto.randomUUID() }).access_token));
  return mine.get(account.email)!;
};

beforeEach(() => {
  clock = new Date("2027-03-01T10:00:00Z");
});

describe("demo data", () => {
  it("holds three demo operatives and only theirs: no password hashes, no money, no manager notes", () => {
    const text = JSON.stringify(D);
    expect(text).not.toMatch(/hash|argon|bcrypt|manager_notes|total_pence|invoice/i);
    expect(D.accounts.map((a) => a.user.full_name)).toEqual(["Dan Hughes", "Priya Shah", "Tom Bennett"]);
    expect(D.accounts.map((a) => a.email)).toEqual(["painter@jobproof.test", "priya.shah@jobproof.test", "tom.bennett@jobproof.test"]);
    for (const a of D.accounts) {
      expect(a.user.role).toBe("painter");
      expect(a.jobs.length).toBeGreaterThan(5);
      expect(new Set(a.jobs.map((j) => j.reference)).size).toBe(a.jobs.length);
    }
    const ids = D.accounts.flatMap((a) => a.jobs.map((j) => j.id));
    expect(new Set(ids).size).toBe(ids.length); // no job belongs to two operatives
  });

  it("loginsOf lists name, email and password for each account, never jobs", () => {
    expect(loginsOf(D)).toEqual(D.accounts.map((a) => ({ name: a.user.full_name, email: a.email, password: a.password })));
  });
});

describe("sessions", () => {
  it("only the published demo operative signs in", () => {
    const api = make();
    const session = api.createSession(login);
    expect(session).toMatchObject({ token_type: "bearer", expires_in: ACCESS_TTL_SECONDS, user: { email: DAN.email, role: "painter" } });
    expect(session.refresh_token.length).toBeGreaterThanOrEqual(20);
    fails(() => api.createSession({ ...login, password: "wrong" }), 401, "invalid_credentials");
    fails(() => api.createSession({ ...login, email: "manager@jobproof.test", password: "Manager123!" }), 401, "invalid_credentials");
    expect(api.createSession({ ...login, email: ` ${DAN.email.toUpperCase()} ` }).user.id).toBe(DAN.user.id);
  });

  it("each of the three operatives signs in with their own email; a wrong password or other email is refused the same way", () => {
    const api = make();
    for (const a of D.accounts) expect(api.createSession({ ...login, email: a.email, password: a.password }).user).toMatchObject({ email: a.email, full_name: a.user.full_name });
    const wrongPassword = fails(() => api.createSession({ ...login, email: PRIYA.email, password: DAN.password + "x" }), 401, "invalid_credentials");
    const unknownEmail = fails(() => api.createSession({ ...login, email: "gareth.lewis@jobproof.test", password: PRIYA.password }), 401, "invalid_credentials");
    expect(unknownEmail.message).toBe(wrongPassword.message);
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
    expect(api.authenticate(bearer(s.access_token)).user.id).toBe(DAN.user.id);
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
    const list = api.listJobs(as(api));
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
    const open = old.accounts[0]!.jobs.find((j) => j.reference === "JP-1064")!;
    open.scheduled_start = "2026-10-10"; // 36 days before the data's own today
    const older = new OperativeBackend(old, { now: () => new Date("2026-11-15T12:00:00Z") });
    expect(older.listJobs(as(older)).earlier_unfinished).toEqual([]);
    open.scheduled_start = "2026-10-20"; // 26 days before
    const newer = new OperativeBackend(old, { now: () => new Date("2026-11-15T12:00:00Z") });
    expect(newer.listJobs(as(newer)).earlier_unfinished.map((j) => j.reference)).toEqual(["JP-1064"]);
  });

  it("gives the full job with checklist, contact and report; leaves out the demo's bookkeeping", () => {
    const api = make();
    const id = api.listJobs(as(api)).jobs_today[0]!.id;
    const job = api.getJob(as(api), id) as unknown as Record<string, unknown>;
    expect(Object.keys(job)).not.toContain("_job_status");
    expect(job).toMatchObject({ reference: "JP-1061", status: "to_do", checklist_total: 9, checklist_dealt_with: 0, report: null });
    expect(api.getJob(as(api), id.toUpperCase()).id).toBe(id); // ids are case-insensitive UUIDs
  });

  it("an unknown or malformed job is a 404, never a hint", () => {
    const api = make();
    fails(() => api.getJob(as(api), "00000000-0000-4000-8000-000000000000"), 404, "not_found");
    fails(() => api.getJob(as(api), "not-a-uuid"), 404, "not_found");
  });
});

describe("one operative never sees another's work", () => {
  it("each login lists only its own jobs, with its own 'today'", () => {
    const api = make();
    const refs = (a: typeof DAN) => api.listJobs(as(api, a)).jobs_today.map((j) => j.reference);
    expect(refs(DAN)).toEqual(["JP-1061", "JP-1062", "JP-1063"]);
    expect(refs(PRIYA)).toEqual(["JP-1066", "JP-1065"]); // to do first, then the one already submitted
    expect(refs(TOM)).toEqual(["JP-1067"]);
    const mine = (a: typeof DAN) => [...api.listJobs(as(api, a)).jobs_today, ...api.listJobs(as(api, a)).earlier_unfinished].map((j) => j.id);
    for (const a of D.accounts) for (const id of mine(a)) expect(a.jobs.map((j) => j.id)).toContain(id);
  });

  it("another operative's job is a 404 to read and to write, whatever its id", () => {
    const api = make();
    const dansId = DAN.jobs.find((j) => j.reference === "JP-1061")!.id;
    fails(() => api.getJob(as(api, PRIYA), dansId), 404, "not_found");
    fails(() => api.saveDraft(as(api, TOM), dansId, { notes: "mine now" }), 404, "not_found");
    expect(api.getJob(as(api, DAN), dansId).report).toBeNull(); // and nothing was written
  });

  it("drafts are per account and sessions belong to their account", () => {
    const api = make();
    const priyas = api.listJobs(as(api, PRIYA)).jobs_today.find((j) => j.status === "to_do")!;
    api.saveDraft(as(api, PRIYA), priyas.id, { notes: "Priya's note" });
    expect(api.getJob(as(api, PRIYA), priyas.id).report!.notes).toBe("Priya's note");
    expect(api.authenticate(as(api, PRIYA)).user.email).toBe(PRIYA.email);
    expect(api.authenticate(as(api, DAN)).user.email).toBe(DAN.email);
    api.endSession(as(api, PRIYA));
    expect(api.authenticate(as(api, DAN)).user.email).toBe(DAN.email); // Priya signing out leaves Dan's session alone
  });
});

describe("saving the draft report", () => {
  const todo = (api: OperativeBackend) => api.listJobs(as(api)).jobs_today[0]!;

  it("creates the draft on first write, starts the job and counts dealt-with items", () => {
    const api = make();
    const job = todo(api);
    const [a, b] = job.checklist;
    const saved = api.saveDraft(as(api), job.id, {
      notes: "Two coats on the lounge.",
      checklist: [
        { item_id: a!.id, status: "done" },
        { item_id: b!.id, status: "not_done" }, // no reason yet: not counted
      ],
    });
    expect(saved.status).toBe("in_progress");
    expect(saved.report).toMatchObject({ state: "draft", notes: "Two coats on the lounge." });
    expect(saved.checklist_dealt_with).toBe(1);
    const again = api.saveDraft(as(api), job.id, { checklist: [{ item_id: b!.id, note: "Customer away" }] });
    expect(again.checklist_dealt_with).toBe(2);
    expect(api.getJob(as(api), job.id).report!.notes).toBe("Two coats on the lounge.");
    expect(api.saveDraft(as(api), job.id, { notes: "  " }).report!.notes).toBeNull(); // blank clears
  });

  it("the draft is also what the list shows afterwards", () => {
    const api = make();
    const job = todo(api);
    api.saveDraft(as(api), job.id, { notes: "x" });
    expect(api.listJobs(as(api)).jobs_today.find((j) => j.id === job.id)!.status).toBe("in_progress");
  });

  it("refuses bad bodies with field errors", () => {
    const api = make();
    const job = todo(api);
    fails(() => api.saveDraft(as(api), job.id, {}), 422, "validation_error");
    fails(() => api.saveDraft(as(api), job.id, { extra: 1 }), 422, "validation_error");
    fails(() => api.saveDraft(as(api), job.id, { notes: "x".repeat(2001) }), 422, "validation_error");
    fails(() => api.saveDraft(as(api), job.id, { checklist: [] }), 422, "validation_error");
    fails(() => api.saveDraft(as(api), job.id, { checklist: [{ item_id: "00000000-0000-4000-8000-000000000009", status: "done" }] }), 422, "validation_error");
    fails(() => api.saveDraft(as(api), job.id, { checklist: [{ item_id: job.checklist[0]!.id }] }), 422, "validation_error");
    fails(() => api.saveDraft(as(api), job.id, { checklist: [{ item_id: job.checklist[0]!.id, status: "maybe" }] }), 422, "validation_error");
    fails(() => api.saveDraft(as(api), job.id, { checklist: [{ item_id: job.checklist[0]!.id, status: "done" }, { item_id: job.checklist[0]!.id, status: "open" }] }), 422, "validation_error");
    fails(() => api.saveDraft(as(api), job.id, null), 422, "validation_error");
  });

  it("refuses a submitted report with 409 report_submitted", () => {
    const api = make();
    const submitted = DAN.jobs.find((j) => j.report?.state === "submitted")!;
    // Its date is long past, so ask for it by id (detail works for any date).
    const problem = fails(() => api.saveDraft(as(api), submitted.id, { notes: "late" }), 409, "report_submitted");
    expect(problem.extra.submitted_at).toBeTruthy();
  });
});
