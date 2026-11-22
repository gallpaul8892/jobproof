import { ApiError, configureApiClient, type DraftUpdate, type OperativeJob } from "@jobproof/shared";
import { DraftRepo } from "../db/draftRepo";
import { SqliteUnsentItemsSource } from "../db/unsentSource";
import { openTestDb } from "../../test/support/nodeSqliteDb";
import { json, problemResponse } from "../../test/helpers";
import { SyncEngine, httpDraftApi, syncStatusLine, toBody, type DraftApi, type SyncSnapshot } from "./engine";

const OPEN = { status: "open", note: null } as const;
const fail = (status: number, code: string, extra: { retryAfterSeconds?: number; problem?: Record<string, unknown> } = {}) => new ApiError({ status, code, title: code, ...extra });
const settle = () => new Promise<void>((r) => setImmediate(r));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** An engine over a real database and a scripted API, with a clock and timers the test drives. */
function setup(options: { user?: string; editDelayMs?: number } = {}) {
  const db = openTestDb();
  const listeners = new Set<() => void>();
  const drafts = new DraftRepo(db, () => listeners.forEach((l) => l()));
  let user: string | undefined = options.user ?? "dan";
  let clock = 1_000_000;
  const timers: { id: number; at: number; fn: () => void }[] = [];
  let nextTimer = 1;
  const delays: number[] = [];
  const calls: { jobId: string; body: DraftUpdate }[] = [];
  const saved: OperativeJob[] = [];
  const script = { next: (async (jobId: string) => ({ id: jobId }) as OperativeJob) as (jobId: string, body: DraftUpdate) => Promise<OperativeJob> };
  let active = 0;
  let maxActive = 0;
  const api: DraftApi = {
    saveDraft: async (jobId, body) => {
      calls.push({ jobId, body });
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        return await script.next(jobId, body);
      } finally {
        active -= 1;
      }
    },
  };
  const engine = new SyncEngine({
    drafts,
    api,
    currentUserId: () => user,
    subscribeLocal: (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    onSaved: (job) => saved.push(job),
    now: () => clock,
    random: () => 0.5, // the middle of the jitter range: delays are exactly the schedule
    setTimer: (fn, ms) => {
      delays.push(ms);
      const t = { id: nextTimer++, at: clock + ms, fn };
      timers.push(t);
      return t.id;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
    editDelayMs: options.editDelayMs,
  });
  engine.start();
  return {
    db,
    drafts,
    engine,
    calls,
    saved,
    script,
    delays,
    timers,
    maxActive: () => maxActive,
    setUser: (u: string | undefined) => void (user = u),
    /** Moves the clock and runs the timers that become due. */
    advance: async (ms: number) => {
      clock += ms;
      for (const t of timers.filter((x) => x.at <= clock)) {
        timers.splice(timers.indexOf(t), 1);
        t.fn();
      }
      await settle();
    },
    unsent: () => new SqliteUnsentItemsSource(db).summaryFor("dan"),
  };
}

describe("draft sync: what is sent", () => {
  it("sends the dirty fields once, as set-to-value, then nothing more", async () => {
    const t = setup();
    t.drafts.setItem("dan", "job-a", "i1", { status: "done" }, OPEN);
    t.drafts.setItem("dan", "job-a", "i2", { status: "not_done", note: "Customer took the tin" }, OPEN);
    t.drafts.setNotes("dan", "job-a", "All rooms done.", null);
    await t.engine.trigger("start");
    expect(t.calls).toEqual([
      {
        jobId: "job-a",
        body: {
          notes: "All rooms done.",
          checklist: [
            { item_id: "i1", status: "done", note: null },
            { item_id: "i2", status: "not_done", note: "Customer took the tin" },
          ],
        },
      },
    ]);
    expect(t.saved).toHaveLength(1);
    expect(t.drafts.dirtyJobIds("dan")).toEqual([]);
    await t.engine.trigger("foreground");
    await t.engine.syncNow();
    expect(t.calls).toHaveLength(1); // nothing is dirty: nothing is sent
  });

  it("omits fields that did not change, and sends a cleared note as null", async () => {
    const t = setup();
    t.drafts.setNotes("dan", "job-a", null, "server text");
    await t.engine.trigger("start");
    expect(t.calls[0]!.body).toEqual({ notes: null });
    expect(toBody({ jobId: "j", items: [{ itemId: "i", status: "open", note: null, rev: 1 }] })).toEqual({ checklist: [{ item_id: "i", status: "open", note: null }] });
  });

  it("sends each job in its own request", async () => {
    const t = setup();
    t.drafts.setNotes("dan", "job-b", "b", null);
    t.drafts.setNotes("dan", "job-a", "a", null);
    await t.engine.trigger("start");
    expect(t.calls.map((c) => c.jobId)).toEqual(["job-a", "job-b"]);
  });

  it("an edit made during an in-flight PATCH is sent in the next request, not lost and not sent twice", async () => {
    const t = setup();
    const gate = deferred<OperativeJob>();
    t.script.next = (jobId) => (t.calls.length === 1 ? gate.promise : Promise.resolve({ id: jobId } as OperativeJob));
    t.drafts.setItem("dan", "job-a", "i1", { status: "done" }, OPEN);
    const run = t.engine.trigger("start");
    await settle();
    expect(t.calls).toHaveLength(1);
    t.drafts.setItem("dan", "job-a", "i1", { note: "added while sending" }, OPEN);
    t.drafts.setNotes("dan", "job-a", "typed meanwhile", null);
    gate.resolve({ id: "job-a" } as OperativeJob);
    await run;
    expect(t.calls).toHaveLength(2);
    expect(t.calls[0]!.body).toEqual({ checklist: [{ item_id: "i1", status: "done", note: null }] });
    expect(t.calls[1]!.body).toEqual({ notes: "typed meanwhile", checklist: [{ item_id: "i1", status: "done", note: "added while sending" }] });
    expect(t.drafts.dirtyJobIds("dan")).toEqual([]);
  });

  it("a trigger during a run cannot start a second request at the same time (retry racing Sync now)", async () => {
    const t = setup();
    const gate = deferred<OperativeJob>();
    t.script.next = (jobId) => (t.calls.length === 1 ? gate.promise : Promise.resolve({ id: jobId } as OperativeJob));
    t.drafts.setNotes("dan", "job-a", "n", null);
    const a = t.engine.trigger("timer");
    await settle();
    const b = t.engine.syncNow();
    const c = t.engine.trigger("foreground");
    await settle();
    expect(t.calls).toHaveLength(1);
    gate.resolve({ id: "job-a" } as OperativeJob);
    await Promise.all([a, b, c]);
    expect(t.maxActive()).toBe(1);
    expect(t.calls).toHaveLength(1); // the second round found nothing dirty: one report, sent once
  });

  it("the unsent count behind sign-out drops to zero once everything is sent", async () => {
    const t = setup();
    t.drafts.setNotes("dan", "job-a", "n", null);
    t.drafts.setItem("dan", "job-b", "i1", { status: "done" }, OPEN);
    expect(t.unsent()).toEqual({ photos: 0, reports: 2 });
    await t.engine.trigger("start");
    expect(t.unsent()).toEqual({ photos: 0, reports: 0 });
  });
});

describe("draft sync: edits are sent 2 s after the last one", () => {
  it("waits for a quiet 2 s, and restarts the wait on every edit", async () => {
    const t = setup();
    t.drafts.setNotes("dan", "job-a", "a", null);
    expect(t.delays).toEqual([2000]);
    await t.advance(1500);
    t.drafts.setNotes("dan", "job-a", "ab", null);
    await t.advance(1999);
    expect(t.calls).toHaveLength(0);
    await t.advance(1);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.body).toEqual({ notes: "ab" });
  });

  it("does not wait on a timer for a change that is not a draft edit", async () => {
    const t = setup();
    t.db.run("INSERT INTO sync_meta VALUES ('x', '1')");
    t.drafts.setError("dan", "job-none", null);
    expect(t.timers).toHaveLength(0);
  });
});

describe("draft sync: retry and backoff", () => {
  it("5xx: retries after 5 s, 15 s, 1 min, 5 min, then every 15 min, and shows the wait", async () => {
    const t = setup();
    t.script.next = async () => {
      throw fail(503, "busy");
    };
    t.drafts.setNotes("dan", "job-a", "n", null);
    await t.advance(2000); // the edit timer
    expect(t.calls).toHaveLength(1);
    expect(t.engine.getSnapshot()).toMatchObject({ waiting: "server", reports: 1, running: false });
    const schedule = [5_000, 15_000, 60_000, 300_000, 900_000, 900_000];
    for (const [i, delay] of schedule.entries()) {
      expect(t.delays.at(-1)).toBe(delay);
      await t.advance(delay - 1);
      expect(t.calls).toHaveLength(1 + i);
      await t.advance(1);
      expect(t.calls).toHaveLength(2 + i);
    }
    expect(t.drafts.dirtyJobIds("dan")).toEqual(["job-a"]); // never dropped
  });

  it("a network error waits for signal; success clears the wait and resets the schedule", async () => {
    const t = setup();
    let down = true;
    t.script.next = async (jobId) => {
      if (down) throw fail(0, "network_error");
      return { id: jobId } as OperativeJob;
    };
    t.drafts.setNotes("dan", "job-a", "n", null);
    await t.engine.trigger("start");
    expect(t.engine.getSnapshot().waiting).toBe("offline");
    expect(syncStatusLine(t.engine.getSnapshot())).toBe("Waiting for signal (1 report)");
    down = false;
    await t.advance(5_000);
    expect(t.engine.getSnapshot()).toMatchObject({ waiting: undefined, reports: 0 });
    expect(syncStatusLine(t.engine.getSnapshot())).toBe("All sent");
    // The next failure starts again at 5 s.
    down = true;
    t.drafts.setNotes("dan", "job-a", "m", null);
    await t.advance(2000);
    expect(t.delays.at(-1)).toBe(5_000);
  });

  it("Retry-After wins when it is longer than the backoff", async () => {
    const t = setup();
    t.script.next = async () => {
      throw fail(503, "busy", { retryAfterSeconds: 120 });
    };
    t.drafts.setNotes("dan", "job-a", "n", null);
    await t.engine.trigger("start");
    expect(t.delays.at(-1)).toBe(120_000);
  });

  it("an edit does not hit a failing server during backoff, but foreground and Sync now do", async () => {
    const t = setup();
    t.script.next = async () => {
      throw fail(500, "internal_error");
    };
    t.drafts.setNotes("dan", "job-a", "n", null);
    await t.engine.trigger("start");
    expect(t.calls).toHaveLength(1);
    t.drafts.setNotes("dan", "job-a", "nn", null);
    await t.advance(2000); // the 2 s edit timer fires inside the 5 s backoff
    expect(t.calls).toHaveLength(1);
    await t.engine.trigger("foreground");
    expect(t.calls).toHaveLength(2);
    await t.engine.syncNow();
    expect(t.calls).toHaveLength(3);
  });

  it("an edit that arrives while a failing request is in flight does not retry at once", async () => {
    const t = setup();
    const gate = deferred<OperativeJob>();
    t.script.next = () => gate.promise;
    t.drafts.setNotes("dan", "job-a", "n", null);
    const run = t.engine.trigger("start");
    await settle();
    t.drafts.setNotes("dan", "job-a", "nn", null);
    gate.reject(fail(503, "busy"));
    await run;
    expect(t.calls).toHaveLength(1);
    expect(t.delays.at(-1)).toBe(5_000);
  });
});

describe("draft sync: sessions", () => {
  afterEach(() => configureApiClient({ baseUrl: "http://api.test", fetch: async () => json({}) }));

  it("401: the shared client refreshes once and retries, and the engine never sees the 401", async () => {
    let token = "t1";
    const seen: string[] = [];
    configureApiClient({
      baseUrl: "http://api.test",
      tokenStore: { get: () => token, set: () => undefined, clear: () => undefined } as never,
      refresh: async () => {
        token = "t2";
        return true;
      },
      fetch: async (input) => {
        const request = input as Request;
        seen.push(`${request.method} ${new URL(request.url).pathname} ${request.headers.get("Authorization")}`);
        return request.headers.get("Authorization") === "Bearer t1" ? problemResponse(401, "unauthenticated") : json({ id: "job-a" });
      },
    });
    const t = setup();
    (t.engine as unknown as { deps: { api: DraftApi } }).deps.api = httpDraftApi; // the real API over the configured client
    t.drafts.setNotes("dan", "job-a", "n", null);
    await t.engine.trigger("start");
    expect(seen).toEqual(["PATCH /api/v1/operative/jobs/job-a/report Bearer t1", "PATCH /api/v1/operative/jobs/job-a/report Bearer t2"]);
    expect(t.drafts.dirtyJobIds("dan")).toEqual([]);
    expect(t.engine.getSnapshot().paused).toBeUndefined();
  });

  it("401 the refresh cannot fix: the queue is kept, 'Please sign in again to finish sending', and sending resumes after signing in", async () => {
    const t = setup();
    t.script.next = async () => {
      throw fail(401, "session_ended");
    };
    t.drafts.setNotes("dan", "job-a", "n", null);
    await t.engine.trigger("start");
    expect(t.engine.getSnapshot().paused).toBe("sign_in");
    expect(syncStatusLine(t.engine.getSnapshot())).toBe("Please sign in again to finish sending");
    expect(t.drafts.dirtyJobIds("dan")).toEqual(["job-a"]);
    expect(t.delays.filter((d) => d !== 2000)).toEqual([]); // no retry timer: it needs the operative
    t.setUser(undefined); // the session manager has signed the user out
    await t.engine.trigger("foreground");
    expect(t.calls).toHaveLength(1);
    t.script.next = async (jobId) => ({ id: jobId }) as OperativeJob;
    t.setUser("dan"); // signed in again: the start trigger
    await t.engine.trigger("start");
    expect(t.calls).toHaveLength(2);
    expect(t.engine.getSnapshot()).toMatchObject({ paused: undefined, reports: 0 });
  });

  it("per user: another operative's sign-in never sends or marks the first one's work", async () => {
    const t = setup();
    t.drafts.setNotes("dan", "job-a", "Dan's note", null);
    t.setUser("priya");
    await t.engine.trigger("start");
    expect(t.calls).toHaveLength(0);
    expect(t.drafts.dirtyJobIds("dan")).toEqual(["job-a"]);
    t.drafts.setNotes("priya", "job-p", "Priya's note", null);
    await t.engine.trigger("foreground");
    expect(t.calls.map((c) => c.jobId)).toEqual(["job-p"]);
    expect(t.drafts.dirtyJobIds("dan")).toEqual(["job-a"]);
    expect(t.engine.getSnapshot().reports).toBe(0); // the status line is about the signed-in operative
  });

  it("if the user changes while a request is in the air, a failure is recorded for nobody and a success only for its owner", async () => {
    const t = setup();
    const gate = deferred<OperativeJob>();
    t.script.next = () => gate.promise;
    t.drafts.setNotes("dan", "job-a", "n", null);
    const run = t.engine.trigger("start");
    await settle();
    t.setUser("priya");
    gate.reject(fail(404, "not_found"));
    await run;
    expect(t.drafts.attentionJobIds("dan")).toEqual([]); // not blamed on Dan's draft
    expect(t.drafts.dirtyJobIds("dan")).toEqual(["job-a"]);

    // A success belongs to the draft it was sent for, but the new user's caches are not touched.
    t.setUser("dan");
    const second = deferred<OperativeJob>();
    t.script.next = () => second.promise;
    const again = t.engine.trigger("foreground");
    await settle();
    t.setUser("priya");
    second.resolve({ id: "job-a" } as OperativeJob);
    await again;
    expect(t.drafts.dirtyJobIds("dan")).toEqual([]);
    expect(t.saved).toEqual([]);
  });
});

describe("draft sync: permanent answers keep the work and wait for the operative", () => {
  it.each([
    [404, "not_found", "job_changed"],
    [409, "job_cancelled", "job_cancelled"],
    [409, "job_closed", "job_closed"],
    [409, "draft_owned_by_other", "draft_owned_by_other"],
    [409, "report_submitted", "report_submitted"],
    [422, "validation_error", "validation_error"],
  ])("%s %s marks the job as needing attention, is not retried by itself, and nothing is deleted", async (status, code, stored) => {
    const t = setup();
    t.drafts.setItem("dan", "job-a", "i1", { status: "done" }, OPEN);
    t.drafts.setNotes("dan", "job-b", "fine", null);
    t.script.next = async (jobId) => {
      if (jobId === "job-a") throw fail(status, code);
      return { id: jobId } as OperativeJob;
    };
    await t.engine.trigger("start");
    expect(t.drafts.attentionJobIds("dan")).toEqual([{ jobId: "job-a", code: stored }]);
    expect(t.calls.map((c) => c.jobId)).toEqual(["job-a", "job-b"]); // the other job still went
    expect(t.engine.getSnapshot()).toMatchObject({ attention: 1, reports: 0 });
    expect(syncStatusLine(t.engine.getSnapshot())).toBe("Needs attention (1)");
    expect(t.delays.filter((d) => d !== 2000)).toEqual([]); // no retry timer, only the edit timers
    await t.engine.trigger("foreground");
    expect(t.calls).toHaveLength(2); // not retried by itself
    expect(t.drafts.checklist("dan", "job-a")).toHaveLength(1); // still there
    expect(t.unsent().reports).toBe(1);
  });

  it("Sync now gives a stuck job another try, and clears it when the office has fixed things", async () => {
    const t = setup();
    t.drafts.setNotes("dan", "job-a", "n", null);
    t.script.next = async () => {
      throw fail(409, "job_closed");
    };
    await t.engine.trigger("start");
    expect(t.engine.getSnapshot().attention).toBe(1);
    t.script.next = async (jobId) => ({ id: jobId }) as OperativeJob;
    await t.engine.syncNow();
    expect(t.engine.getSnapshot()).toMatchObject({ attention: 0, reports: 0 });
  });

  it("426 pauses everything with the update message; Sync now tries again", async () => {
    const t = setup();
    t.drafts.setNotes("dan", "job-a", "n", null);
    t.script.next = async () => {
      throw fail(426, "app_update_required");
    };
    await t.engine.trigger("start");
    expect(t.engine.getSnapshot().paused).toBe("update_required");
    expect(syncStatusLine(t.engine.getSnapshot())).toBe("Please update the app to continue.");
    await t.engine.trigger("foreground");
    expect(t.calls).toHaveLength(1);
    t.script.next = async (jobId) => ({ id: jobId }) as OperativeJob;
    await t.engine.syncNow();
    expect(t.engine.getSnapshot().paused).toBeUndefined();
    expect(t.calls).toHaveLength(2);
  });
});

describe("draft sync: lifecycle and status", () => {
  it("never throws into the app when the database misbehaves", async () => {
    const t = setup();
    t.drafts.setNotes("dan", "job-a", "n", null);
    jest.spyOn(t.drafts, "readDirty").mockImplementation(() => {
      throw new Error("disk I/O error");
    });
    await expect(t.engine.trigger("start")).resolves.toBeUndefined();
    expect(t.engine.getSnapshot().running).toBe(false);
  });

  it("does nothing once disposed, and drops its timers", async () => {
    const t = setup();
    t.drafts.setNotes("dan", "job-a", "n", null);
    expect(t.timers).toHaveLength(1);
    t.engine.dispose();
    expect(t.timers).toHaveLength(0);
    await t.engine.trigger("start");
    expect(t.calls).toHaveLength(0);
  });

  it("tells subscribers when the snapshot changes, and only then", async () => {
    const t = setup();
    const seen: SyncSnapshot[] = [];
    t.engine.subscribe(() => seen.push(t.engine.getSnapshot()));
    t.drafts.setNotes("dan", "job-a", "n", null);
    expect(seen.at(-1)).toMatchObject({ reports: 1, running: false });
    const before = seen.length;
    t.drafts.setError("dan", "nobody", null); // changes nothing the status shows
    expect(seen).toHaveLength(before);
    await t.engine.trigger("start");
    expect(seen.some((s) => s.running)).toBe(true);
    expect(seen.at(-1)).toMatchObject({ reports: 0, running: false });
  });

  it.each<[Partial<SyncSnapshot>, string]>([
    [{}, "All sent"],
    [{ reports: 1 }, "Waiting to send (1 report)"],
    [{ reports: 2, running: true }, "Sending 2 reports"],
    [{ reports: 1, photos: 3, running: true }, "Sending 1 report and 3 photos"],
    [{ photos: 3, waiting: "offline" }, "Waiting for signal (3 photos)"],
    [{ reports: 1, waiting: "server" }, "Will try again shortly (1 report)"],
    [{ attention: 1, reports: 2 }, "Needs attention (1)"],
    [{ paused: "sign_in", reports: 1 }, "Please sign in again to finish sending"],
    [{ paused: "update_required" }, "Please update the app to continue."],
  ])("status line %j reads %s", (partial, text) => {
    expect(syncStatusLine({ running: false, reports: 0, photos: 0, attention: 0, paused: undefined, waiting: undefined, ...partial })).toBe(text);
  });
});
