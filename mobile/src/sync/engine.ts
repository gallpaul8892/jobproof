import { callApi, saveOperativeDraft, type DraftUpdate, type OperativeJob } from "@jobproof/shared";
import type { DirtyDraft, DraftRepo } from "../db/draftRepo";
import { classify, type Verdict } from "./classify";
import { nextDelayMs } from "./retry";

/** The one server call the skeleton makes. Photos and submit join it in T-003g and T-003h. */
export interface DraftApi {
  saveDraft(jobId: string, body: DraftUpdate): Promise<OperativeJob>;
}

/** The real thing: the generated client through the shared adapter (bearer token, one refresh on 401). */
export const httpDraftApi: DraftApi = {
  saveDraft: (jobId, body) => callApi(() => saveOperativeDraft({ path: { job_id: jobId }, body })),
};

export type Trigger = "start" | "foreground" | "reconnect" | "edit" | "timer" | "manual";

export type Paused = "sign_in" | "update_required";

/** What the header line and the Sync screen read (Observer, via useSyncExternalStore). */
export interface SyncSnapshot {
  running: boolean;
  /** Jobs with changes still to send. */
  reports: number;
  /** Photos still to send (T-003g feeds this; always 0 until then). */
  photos: number;
  /** Jobs that cannot be sent until the operative or the office acts. */
  attention: number;
  paused: Paused | undefined;
  /** A retry is scheduled: "offline" for no signal, "server" for a server problem. */
  waiting: "offline" | "server" | undefined;
}

const EMPTY: SyncSnapshot = { running: false, reports: 0, photos: 0, attention: 0, paused: undefined, waiting: undefined };

export interface SyncDeps {
  drafts: DraftRepo;
  api: DraftApi;
  /** The signed-in operative, or undefined when no one is (or the session needs signing in again). */
  currentUserId: () => string | undefined;
  /** Called after any local change (the store's Observer); the engine re-counts and schedules a send. */
  subscribeLocal: (listener: () => void) => () => void;
  /**
   * The server's answer to a save: the app puts it in the query cache and makes it durable. The
   * engine waits for this before it commits `synced_rev`, so the phone never shows a server value
   * it could lose in a kill.
   */
  onSaved?: (job: OperativeJob, owner: string) => void | Promise<void>;
  now?: () => number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Quiet time after an edit before it is sent (design 3.4: 2 s). */
  editDelayMs?: number;
}

const sameSnapshot = (a: SyncSnapshot, b: SyncSnapshot) =>
  a.running === b.running && a.reports === b.reports && a.photos === b.photos && a.attention === b.attention && a.paused === b.paused && a.waiting === b.waiting;

/**
 * The draft sync engine (design 3.4): state-based reconciliation. For each job with local work it
 * asks "what makes the server match the phone?", sends it, records the revisions it sent and asks
 * again. Repeats are safe (the PATCH sets values), edits coalesce, nothing has an order to get wrong.
 *
 *  - Single flight per app run: a trigger during a run only sets a "run again" flag, so an
 *    automatic retry racing "Sync now" cannot send twice (T-003j 9).
 *  - Per user: it only ever reads and writes the signed-in operative's rows, and stops quietly if
 *    the signed-in user changes while a request is in the air.
 *  - Local first: it never throws into the UI and never deletes anything; a failure keeps the
 *    work and schedules a retry (or marks the job "needs attention").
 */
export class SyncEngine {
  private snapshot: SyncSnapshot = EMPTY;
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly editDelayMs: number;

  private inFlight: Promise<void> | undefined;
  /** Set by a request that arrives during a run: the run goes round once more. */
  private rerun = false;
  /** ...and when that request was not just an edit, the rerun ignores backoff. */
  private rerunForce = false;
  private rerunManual = false;
  private owner: string | undefined;
  private failures = 0;
  private nextAttemptAt: number | undefined;
  private waiting: SyncSnapshot["waiting"];
  private paused: Paused | undefined;
  private retryTimer: unknown;
  private editTimer: unknown;
  private unsubscribeLocal: (() => void) | undefined;
  private disposed = false;

  constructor(private readonly deps: SyncDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.random = deps.random ?? Math.random;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.editDelayMs = deps.editDelayMs ?? 2_000;
  }

  // ---- Observer ------------------------------------------------------------------------------
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  readonly getSnapshot = (): SyncSnapshot => this.snapshot;

  private refresh(): void {
    const user = this.deps.currentUserId() ?? this.owner;
    const next: SyncSnapshot = user
      ? {
          running: this.inFlight !== undefined,
          reports: this.deps.drafts.dirtyJobIds(user).length,
          photos: 0,
          attention: this.deps.drafts.attentionJobIds(user).length,
          paused: this.paused,
          waiting: this.waiting,
        }
      : EMPTY;
    if (sameSnapshot(this.snapshot, next)) return;
    this.snapshot = next;
    this.listeners.forEach((l) => l());
  }

  // ---- lifecycle -----------------------------------------------------------------------------
  /** Starts watching local edits (they are sent 2 s after the last one). The first pass is the caller's `trigger("start")`. */
  start(): void {
    if (this.disposed || this.unsubscribeLocal) return;
    this.unsubscribeLocal = this.deps.subscribeLocal(() => this.onLocalChange());
    this.refresh();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribeLocal?.();
    this.unsubscribeLocal = undefined;
    this.clearTimers();
    this.listeners.clear();
  }

  private clearTimers(): void {
    if (this.retryTimer !== undefined) this.clearTimer(this.retryTimer);
    if (this.editTimer !== undefined) this.clearTimer(this.editTimer);
    this.retryTimer = undefined;
    this.editTimer = undefined;
  }

  private onLocalChange(): void {
    if (this.disposed) return;
    this.refresh();
    if (this.inFlight !== undefined) {
      // An edit during a run is picked up by the run itself (it re-reads what is dirty) or by one more round.
      if (this.snapshot.reports > 0) this.rerun = true;
      return;
    }
    if (this.snapshot.reports > 0 && this.paused === undefined) {
      if (this.editTimer !== undefined) this.clearTimer(this.editTimer);
      this.editTimer = this.setTimer(() => {
        this.editTimer = undefined;
        void this.trigger("edit");
      }, this.editDelayMs);
    }
  }

  // ---- triggers ------------------------------------------------------------------------------
  /** "Sync now": ignores backoff and gives stuck jobs another try. */
  syncNow(): Promise<void> {
    return this.trigger("manual");
  }

  /**
   * Asks for a pass. Resolves when the pass that covers this request has finished. An edit
   * trigger respects backoff (a failing server is not hammered after every keystroke); the others
   * do not: starting, coming to the foreground, regaining signal, a due timer and Sync now.
   */
  trigger(reason: Trigger): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (reason === "edit" && this.nextAttemptAt !== undefined && this.now() < this.nextAttemptAt) return this.inFlight ?? Promise.resolve();
    if (this.inFlight) {
      this.rerun = true;
      if (reason !== "edit") this.rerunForce = true;
      if (reason === "manual") this.rerunManual = true;
      return this.inFlight;
    }
    const run = this.loop(reason === "manual").finally(() => {
      this.inFlight = undefined;
      this.refresh();
    });
    this.inFlight = run;
    this.refresh();
    return run;
  }

  private async loop(manual: boolean): Promise<void> {
    for (;;) {
      this.rerun = false;
      this.rerunForce = false;
      this.rerunManual = false;
      try {
        await this.pass(manual);
      } catch {
        // A bug or a storage failure must not crash the app or lose work: the next trigger tries again.
      }
      if (!this.rerun || this.disposed) return;
      // A request that arrived mid-run runs once more, but an edit alone waits out a backoff.
      const backoffOpen = this.nextAttemptAt === undefined || this.now() >= this.nextAttemptAt;
      if (!this.rerunForce && !backoffOpen) return;
      manual = this.rerunManual;
    }
  }

  // ---- one pass: step 2 of design 3.4 (PATCH dirty drafts) -----------------------------------
  private async pass(manual: boolean): Promise<void> {
    const owner = this.deps.currentUserId();
    if (!owner) return;
    if (owner !== this.owner) {
      // Another operative: nothing carries over (backoff, pauses), and nothing of theirs is touched.
      this.owner = owner;
      this.failures = 0;
      this.nextAttemptAt = undefined;
      this.waiting = undefined;
      this.paused = undefined;
    }
    if (this.paused === "sign_in") this.paused = undefined; // a pass with a signed-in user is the "signed in again" signal
    if (manual) {
      this.paused = undefined;
      this.deps.drafts.clearErrors(owner);
    }
    if (this.paused === "update_required") return;
    if (this.retryTimer !== undefined) {
      this.clearTimer(this.retryTimer);
      this.retryTimer = undefined;
    }
    this.waiting = undefined;

    for (const jobId of this.deps.drafts.dirtyJobIds(owner)) {
      if (this.deps.currentUserId() !== owner) return;
      const outcome = await this.sendJob(owner, jobId);
      if (outcome === "stop") return;
    }
  }

  private async sendJob(owner: string, jobId: string): Promise<"done" | "continue" | "stop"> {
    for (;;) {
      const dirty = this.deps.drafts.readDirty(owner, jobId);
      if (!dirty) return "done";
      let saved: OperativeJob;
      try {
        saved = await this.deps.api.saveDraft(jobId, toBody(dirty));
      } catch (error) {
        // The signed-in user changed while the request was in the air: record nothing for it.
        if (this.deps.currentUserId() !== owner) return "stop";
        return this.handle(owner, jobId, classify(error));
      }
      if (this.deps.currentUserId() === owner) {
        try {
          await this.deps.onSaved?.(saved, owner);
        } catch {
          // A cache or storage problem must not block the sync: the display falls back to a refetch.
        }
      }
      this.deps.drafts.markSynced(owner, dirty);
      this.failures = 0;
      this.nextAttemptAt = undefined;
    }
  }

  private handle(owner: string, jobId: string, verdict: Verdict): "continue" | "stop" {
    switch (verdict.kind) {
      case "retry": {
        this.failures += 1;
        const delay = nextDelayMs(this.failures, verdict.retryAfterSeconds, this.random);
        this.nextAttemptAt = this.now() + delay;
        this.waiting = verdict.offline ? "offline" : "server";
        if (this.retryTimer !== undefined) this.clearTimer(this.retryTimer);
        this.retryTimer = this.setTimer(() => {
          this.retryTimer = undefined;
          void this.trigger("timer");
        }, delay);
        return "stop";
      }
      case "session_ended": {
        if (this.deps.currentUserId() === owner) {
          // Still signed in: the refresh failed for a passing reason (the session manager keeps the
          // session then). Back off and try again; pause only when the user is really gone.
          return this.handle(owner, jobId, { kind: "retry", offline: false });
        }
        this.paused = "sign_in";
        return "stop";
      }
      case "update_required":
        this.paused = "update_required";
        return "stop";
      case "needs_attention":
        this.deps.drafts.setError(owner, jobId, verdict.code);
        return "continue";
      case "report_submitted":
        this.deps.drafts.setError(owner, jobId, "report_submitted");
        return "continue";
      default:
        // Photo and submit verdicts belong to T-003g/h; a draft save never gets them, but if one
        // arrives the work is kept and shown as needing attention.
        this.deps.drafts.setError(owner, jobId, "unexpected_response");
        return "continue";
    }
  }
}

/** The PATCH body: every dirty value as it is now (set-to-value, so a repeat is harmless). */
export function toBody(dirty: DirtyDraft): DraftUpdate {
  return {
    ...(dirty.notes ? { notes: dirty.notes.value } : {}),
    ...(dirty.items.length > 0 ? { checklist: dirty.items.map((i) => ({ item_id: i.itemId, status: i.status, note: i.note })) } : {}),
  };
}

/** Header wording (design 3.4): "All sent", "Sending 1 report", "Waiting for signal (1 report)", "Needs attention (1)". */
export function syncStatusLine(s: SyncSnapshot): string {
  if (s.paused === "update_required") return "Please update the app to continue.";
  if (s.paused === "sign_in") return "Please sign in again to finish sending";
  const parts: string[] = [];
  if (s.reports > 0) parts.push(`${s.reports} ${s.reports === 1 ? "report" : "reports"}`);
  if (s.photos > 0) parts.push(`${s.photos} ${s.photos === 1 ? "photo" : "photos"}`);
  const what = parts.join(" and ");
  if (s.attention > 0) return `Needs attention (${s.attention})`;
  if (what === "") return "All sent";
  if (s.running) return `Sending ${what}`;
  if (s.waiting === "offline") return `Waiting for signal (${what})`;
  if (s.waiting === "server") return `Will try again shortly (${what})`;
  return `Waiting to send (${what})`;
}
