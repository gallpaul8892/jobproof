import { callApi, configureApiClient, ApiError } from "@jobproof/shared";
// The generated SDK calls are not part of the shared public entry; tests reach them directly (as test/helpers.ts does).
import { createDeviceSession, getAppStatus, getBranding, getOperativeJob, listOperativeJobs, saveOperativeDraft } from "../../../shared/src/generated";
import { DraftRepo } from "../../src/db/draftRepo";
import { applyPragmas, migrate } from "../../src/db/migrations";
import { SyncEngine, httpDraftApi } from "../../src/sync/engine";
import { MemoryDb } from "../memoryDb";
import data from "./operativeData.json";
import { OperativeBackend } from "./backend";
import type { OperativeMockData } from "./data";
import { createDemoFetch } from "./fetch";

const D = data as unknown as OperativeMockData;
const DEVICE = "6f1b6d0c-0000-4000-8000-000000000002";
const BASE = "http://demo.test";
const body = { email: D.accounts[0]!.email, password: D.accounts[0]!.password, device_id: DEVICE, platform: "android" as const, app_version: "0.1.0" };

function setup() {
  const backend = new OperativeBackend(D, { now: () => new Date("2027-03-01T10:00:00Z") });
  const calls: string[] = [];
  const passthrough = jest.fn(async () => new Response("asset"));
  const demoFetch = createDemoFetch(backend, passthrough as unknown as typeof fetch);
  const spy: typeof fetch = async (input, init) => {
    calls.push(`${(input instanceof Request ? input.method : (init?.method ?? "GET")).toUpperCase()} ${new URL(input instanceof Request ? input.url : String(input)).pathname}`);
    return demoFetch(input, init);
  };
  let token: string | null = null;
  configureApiClient({ baseUrl: BASE, fetch: spy, tokenStore: { get: async () => token, set: async (t: string) => void (token = t), clear: async () => void (token = null) } });
  return { backend, calls, passthrough, demoFetch, setToken: (t: string | null) => void (token = t) };
}

describe("the demo fetch, through the real generated API client", () => {
  it("answers branding and app status without signing in", async () => {
    setup();
    const branding = await callApi(() => getBranding());
    expect(branding.company_name.length).toBeGreaterThan(0);
    const status = await callApi(() => getAppStatus());
    expect(status.min_supported_versions.android).toBe("0.0.0");
  });

  it("signs in, lists jobs, opens one and saves a draft", async () => {
    const { setToken } = setup();
    const session = await callApi(() => createDeviceSession({ body }), { refresh: false });
    setToken(session.access_token);
    const list = await callApi(() => listOperativeJobs());
    expect(list.jobs_today).toHaveLength(3);
    const job = await callApi(() => getOperativeJob({ path: { job_id: list.jobs_today[0]!.id } }));
    expect(job.reference).toBe("JP-1061");
    const saved = await callApi(() => saveOperativeDraft({ path: { job_id: job.id }, body: { notes: "Started" } }));
    expect(saved.report!.notes).toBe("Started");
  });

  it("each operative sees only their own jobs over HTTP; another operative's job is a 404", async () => {
    const { setToken } = setup();
    const sign = (i: number) => callApi(() => createDeviceSession({ body: { ...body, email: D.accounts[i]!.email, password: D.accounts[i]!.password } }), { refresh: false });
    setToken((await sign(1)).access_token);
    const priya = await callApi(() => listOperativeJobs());
    expect(priya.jobs_today.map((j) => j.reference)).toEqual(["JP-1066", "JP-1065"]);
    const danJob = D.accounts[0]!.jobs.find((j) => j.reference === "JP-1061")!;
    const error = await callApi(() => getOperativeJob({ path: { job_id: danJob.id } }), { refresh: false }).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 404 });
  });

  it("refuses a wrong password with the app's invalid_credentials error", async () => {
    setup();
    const error = await callApi(() => createDeviceSession({ body: { ...body, password: "nope" } }), { refresh: false }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: "invalid_credentials" });
  });

  it("requires a token for jobs", async () => {
    setup();
    const error = await callApi(() => listOperativeJobs(), { refresh: false }).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 401 });
  });

  it("does not pretend to have photo upload or submit (not built on the server yet)", async () => {
    const { demoFetch, backend } = setup();
    const s = backend.createSession(body);
    const auth = { Authorization: `Bearer ${s.access_token}` };
    const id = backend.listJobs(`Bearer ${s.access_token}`).jobs_today[0]!.id;
    for (const [method, path] of [
      ["POST", `/api/v1/operative/jobs/${id}/report/submit`],
      ["PUT", `/api/v1/operative/jobs/${id}/photos/00000000-0000-4000-8000-000000000001`],
      ["PUT", `/api/v1/operative/jobs/${id}/photos/00000000-0000-4000-8000-000000000001/content`],
    ] as const) {
      const res = await demoFetch(`${BASE}${path}`, { method, headers: auth, body: "{}" });
      expect(res.status).toBe(404);
      expect(((await res.json()) as { title: string }).title).toMatch(/not available in the demo/);
    }
  });

  it("wrong method is 405 and an unknown API path is 404, both as problem+json", async () => {
    const { demoFetch } = setup();
    const a = await demoFetch(`${BASE}/api/v1/branding`, { method: "POST" });
    expect(a.status).toBe(405);
    expect(a.headers.get("content-type")).toBe("application/problem+json");
    expect((await demoFetch(`${BASE}/api/v1/manager/dashboard`)).status).toBe(404);
  });

  it("never lets a request out: only same-origin non-API requests go to the passthrough", async () => {
    const { demoFetch, passthrough } = setup();
    await expect(demoFetch("https://cdn.example.com/lib.js")).rejects.toThrow(TypeError);
    await expect(demoFetch("https://api.example.com/api/v1/operative/jobs")).resolves.toBeDefined(); // API paths are always answered locally
    expect(passthrough).not.toHaveBeenCalled();
  });

  it("an aborted request rejects instead of answering", async () => {
    const { demoFetch } = setup();
    const c = new AbortController();
    c.abort();
    await expect(demoFetch(`${BASE}/api/v1/app/status`, { signal: c.signal })).rejects.toBeDefined();
  });
});

describe("the app's draft sync engine against the demo backend (T-003f)", () => {
  async function engineFor(userIndex: number, jobId: string) {
    const { setToken } = setup();
    const account = D.accounts[userIndex]!;
    const session = await callApi(() => createDeviceSession({ body: { ...body, email: account.email, password: account.password } }), { refresh: false });
    setToken(session.access_token);
    const db = new MemoryDb();
    applyPragmas(db);
    migrate(db);
    const drafts = new DraftRepo(db);
    const saved: string[] = [];
    const engine = new SyncEngine({ drafts, api: httpDraftApi, currentUserId: () => account.user.id, subscribeLocal: () => () => undefined, onSaved: (j) => void saved.push(j.id) });
    return { drafts, engine, saved, user: account.user.id, jobId };
  }

  it("sends the app's real request body and the demo accepts it, as the real server would", async () => {
    const job = D.accounts[0]!.jobs.find((j) => j.reference === "JP-1061")!;
    const { drafts, engine, saved, user } = await engineFor(0, job.id);
    const [first, second] = job.checklist;
    drafts.setItem(user, job.id, first!.id, { status: "done" }, { status: first!.status, note: first!.note });
    drafts.setItem(user, job.id, second!.id, { status: "not_done", note: "Customer took the tin" }, { status: second!.status, note: second!.note });
    drafts.setNotes(user, job.id, "All rooms done.\nCustomer happy.", null);
    await engine.syncNow();
    expect(saved).toEqual([job.id]);
    expect(drafts.dirtyJobIds(user)).toEqual([]);
    expect(drafts.attentionJobIds(user)).toEqual([]);
  });

  it("another operative's job is a 404: the work is kept and shown as needing attention", async () => {
    const danJob = D.accounts[0]!.jobs.find((j) => j.reference === "JP-1061")!;
    const { drafts, engine, user } = await engineFor(1, danJob.id); // Priya, Dan's job
    drafts.setNotes(user, danJob.id, "not mine", null);
    await engine.syncNow();
    expect(drafts.attentionJobIds(user)).toEqual([{ jobId: danJob.id, code: "job_changed" }]);
    expect(drafts.draft(user, danJob.id)?.notes).toBe("not mine");
  });
});
