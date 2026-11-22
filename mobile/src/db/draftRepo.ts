import type { ChecklistStatus } from "@jobproof/shared";
import type { LocalDb } from "./localDb";
import type { LocalReportState } from "./photoRepo";

export interface DraftRow {
  owner_user_id: string;
  job_id: string;
  notes: string | null;
  notes_rev: number;
  notes_synced_rev: number;
  local_state: LocalReportState;
  last_error_code: string | null;
}

export interface ChecklistStateRow {
  owner_user_id: string;
  job_id: string;
  item_id: string;
  status: ChecklistStatus;
  note: string | null;
  rev: number;
  synced_rev: number;
}

/** What one job still has to tell the server: the values and the revisions they were read at. */
export interface DirtyDraft {
  jobId: string;
  notes?: { value: string | null; rev: number };
  items: { itemId: string; status: ChecklistStatus; note: string | null; rev: number }[];
}

/** The most items one PATCH carries (contract: 1 to 200). The rest go in the next request of the same run. */
export const MAX_ITEMS_PER_REQUEST = 200;

export class ReportLockedError extends Error {
  constructor() {
    super("This report has been submitted, so it can no longer be changed.");
    this.name = "ReportLockedError";
  }
}

export interface ItemValue {
  status: ChecklistStatus;
  note: string | null;
}

const EDITABLE: readonly LocalReportState[] = ["draft", "rejected"];

/**
 * The draft report on the phone (design 3.3, 3.4). Every edit stores the new value and bumps its
 * `rev`; the sync engine sends a value while `rev > synced_rev` and records the `rev` it sent, so
 * an edit made while a request is in flight stays dirty and goes out next time. The local value
 * is the one to show while `rev > synced_rev`; afterwards the server's value is. Every query
 * filters on `owner_user_id`, so a second operative on the phone never sees or sends these.
 */
export class DraftRepo {
  constructor(
    private readonly db: LocalDb,
    private readonly changed: () => void = () => undefined,
  ) {}

  draft(ownerUserId: string, jobId: string): DraftRow | undefined {
    return this.db.get<DraftRow>("SELECT * FROM drafts WHERE owner_user_id = ? AND job_id = ?", [ownerUserId, jobId]);
  }

  checklist(ownerUserId: string, jobId: string): ChecklistStateRow[] {
    return this.db.all<ChecklistStateRow>("SELECT * FROM checklist_states WHERE owner_user_id = ? AND job_id = ?", [ownerUserId, jobId]);
  }

  isEditable(ownerUserId: string, jobId: string): boolean {
    const state = this.draft(ownerUserId, jobId)?.local_state;
    return state === undefined || EDITABLE.includes(state);
  }

  /** Records the operative's change to one item. `server` is what the item shows now (the base for the first edit). No-op when nothing changes. */
  setItem(ownerUserId: string, jobId: string, itemId: string, change: { status?: ChecklistStatus; note?: string | null }, server: ItemValue): void {
    const wrote = this.db.transaction(() => {
      this.guard(ownerUserId, jobId);
      const row = this.db.get<ChecklistStateRow>("SELECT * FROM checklist_states WHERE owner_user_id = ? AND job_id = ? AND item_id = ?", [ownerUserId, jobId, itemId]);
      const current: ItemValue = row && row.rev > row.synced_rev ? { status: row.status, note: row.note } : server;
      const next: ItemValue = { status: change.status ?? current.status, note: "note" in change ? (change.note ?? null) : current.note };
      if (next.status === current.status && next.note === current.note) return false;
      if (row) {
        this.db.run("UPDATE checklist_states SET status = ?, note = ?, rev = rev + 1 WHERE owner_user_id = ? AND job_id = ? AND item_id = ?", [next.status, next.note, ownerUserId, jobId, itemId]);
      } else {
        this.db.run("INSERT INTO checklist_states (owner_user_id, job_id, item_id, status, note, rev, synced_rev) VALUES (?, ?, ?, ?, ?, 1, 0)", [ownerUserId, jobId, itemId, next.status, next.note]);
      }
      return true;
    });
    if (wrote) this.changed();
  }

  /** Records the overall job note. `server` is the note the server holds (the base for the first edit). */
  setNotes(ownerUserId: string, jobId: string, notes: string | null, server: string | null): void {
    const wrote = this.db.transaction(() => {
      this.guard(ownerUserId, jobId);
      const row = this.draft(ownerUserId, jobId)!;
      const current = row.notes_rev > row.notes_synced_rev ? row.notes : server;
      if (notes === current) return false;
      this.db.run("UPDATE drafts SET notes = ?, notes_rev = notes_rev + 1 WHERE owner_user_id = ? AND job_id = ?", [notes, ownerUserId, jobId]);
      return true;
    });
    if (wrote) this.changed();
  }

  /** Makes sure the draft row exists and may still be edited. */
  private guard(ownerUserId: string, jobId: string): void {
    this.db.run("INSERT OR IGNORE INTO drafts (owner_user_id, job_id) VALUES (?, ?)", [ownerUserId, jobId]);
    if (!this.isEditable(ownerUserId, jobId)) throw new ReportLockedError();
  }

  // ---- for the sync engine -------------------------------------------------------------------

  /**
   * Jobs with something to send, oldest edit order not tracked (one PATCH per job, the order does
   * not matter). A job that failed for good (`last_error_code`) is left out unless `withErrors`.
   */
  dirtyJobIds(ownerUserId: string, withErrors = false): string[] {
    const drafts = this.db.all<DraftRow>("SELECT * FROM drafts WHERE owner_user_id = ?", [ownerUserId]);
    const states = this.db.all<ChecklistStateRow>("SELECT * FROM checklist_states WHERE owner_user_id = ? AND rev > synced_rev", [ownerUserId]);
    const dirtyItems = new Set(states.map((s) => s.job_id));
    return drafts
      .filter((d) => EDITABLE.includes(d.local_state))
      .filter((d) => d.notes_rev > d.notes_synced_rev || dirtyItems.has(d.job_id))
      .filter((d) => withErrors || d.last_error_code === null)
      .map((d) => d.job_id)
      .sort();
  }

  /** Jobs whose changes cannot be sent without the operative (or the office) acting. */
  attentionJobIds(ownerUserId: string): { jobId: string; code: string }[] {
    const attention = new Set(this.dirtyJobIds(ownerUserId, true));
    return this.db
      .all<DraftRow>("SELECT * FROM drafts WHERE owner_user_id = ?", [ownerUserId])
      .filter((d) => d.last_error_code !== null && attention.has(d.job_id))
      .map((d) => ({ jobId: d.job_id, code: d.last_error_code! }));
  }

  /** The next request's worth of changes for one job, or undefined when it is clean. */
  readDirty(ownerUserId: string, jobId: string): DirtyDraft | undefined {
    const draft = this.draft(ownerUserId, jobId);
    if (!draft || !EDITABLE.includes(draft.local_state)) return undefined;
    const items = this.db
      .all<ChecklistStateRow>("SELECT * FROM checklist_states WHERE owner_user_id = ? AND job_id = ? AND rev > synced_rev", [ownerUserId, jobId])
      .sort((a, b) => a.item_id.localeCompare(b.item_id))
      .slice(0, MAX_ITEMS_PER_REQUEST)
      .map((r) => ({ itemId: r.item_id, status: r.status, note: r.note, rev: r.rev }));
    const notes = draft.notes_rev > draft.notes_synced_rev ? { value: draft.notes, rev: draft.notes_rev } : undefined;
    if (!notes && items.length === 0) return undefined;
    return { jobId, ...(notes ? { notes } : {}), items };
  }

  /** The server accepted these values: remember the revisions that went out (a newer edit stays dirty). */
  markSynced(ownerUserId: string, dirty: DirtyDraft): void {
    this.db.transaction(() => {
      if (dirty.notes) {
        this.db.run("UPDATE drafts SET notes_synced_rev = ? WHERE owner_user_id = ? AND job_id = ? AND notes_synced_rev < ?", [dirty.notes.rev, ownerUserId, dirty.jobId, dirty.notes.rev]);
      }
      for (const item of dirty.items) {
        this.db.run("UPDATE checklist_states SET synced_rev = ? WHERE owner_user_id = ? AND job_id = ? AND item_id = ? AND synced_rev < ?", [item.rev, ownerUserId, dirty.jobId, item.itemId, item.rev]);
      }
      this.db.run("UPDATE drafts SET last_error_code = NULL WHERE owner_user_id = ? AND job_id = ?", [ownerUserId, dirty.jobId]);
    });
    this.changed();
  }

  setError(ownerUserId: string, jobId: string, code: string | null): void {
    this.db.run("UPDATE drafts SET last_error_code = ? WHERE owner_user_id = ? AND job_id = ?", [code, ownerUserId, jobId]);
    this.changed();
  }

  /** Sync now: give every stuck job another try (the office may have fixed it). */
  clearErrors(ownerUserId: string): void {
    const stuck = this.attentionJobIds(ownerUserId);
    if (stuck.length === 0) return;
    this.db.run("UPDATE drafts SET last_error_code = NULL WHERE owner_user_id = ?", [ownerUserId]);
    this.changed();
  }
}
