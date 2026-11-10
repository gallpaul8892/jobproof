import type { LocalDb } from "./localDb";

export const STAGES = ["before", "during", "after"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = { before: "Before", during: "During", after: "After" };

export type PhotoSource = "camera" | "gallery";
export type TakenAtSource = "device_clock" | "file_metadata" | "added_time";
export type PhotoSyncState = "saved" | "registered" | "sent" | "failed";
export type LocalReportState = "draft" | "submit_queued" | "submitted" | "rejected";

/** One row of `photos`, exactly as stored (snake_case, 0/1 flags). */
export interface PhotoRow {
  id: string;
  owner_user_id: string;
  job_id: string;
  stage: Stage;
  checklist_item_id: string | null;
  caption: string | null;
  meta_rev: number;
  meta_synced_rev: number;
  source: PhotoSource;
  taken_at: string;
  taken_at_source: TakenAtSource;
  original_path: string;
  original_width: number | null;
  original_height: number | null;
  original_bytes: number | null;
  upload_path: string | null;
  sync_state: PhotoSyncState;
  deleted: 0 | 1;
  created_at: string;
  recovered: 0 | 1;
  thumb_path: string | null;
}

export interface NewPhoto {
  id: string;
  ownerUserId: string;
  jobId: string;
  stage: Stage;
  checklistItemId?: string | null;
  source: PhotoSource;
  takenAt: string;
  takenAtSource: TakenAtSource;
  originalPath: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  createdAt: string;
  recovered?: boolean;
}

/** The report is locked for photo edits once it has been submitted or is being submitted. */
export class PhotoLockedError extends Error {
  constructor() {
    super("This report has been submitted, so its photos can no longer be changed.");
    this.name = "PhotoLockedError";
  }
}

export const MAX_PHOTOS_PER_REPORT = 60;
export const MAX_PHOTOS_PER_ITEM = 12;

/** Every query here filters on owner_user_id: a second operative on the phone never sees the first one's photos. */
export class PhotoRepo {
  constructor(
    private readonly db: LocalDb,
    private readonly changed: () => void = () => undefined,
  ) {}

  /** Inserts the photo and, if the job has no local draft yet, the draft, in one transaction (T-003e A4). */
  insert(p: NewPhoto): void {
    this.db.transaction(() => {
      this.db.run("INSERT OR IGNORE INTO drafts (owner_user_id, job_id) VALUES (?, ?)", [p.ownerUserId, p.jobId]);
      this.db.run(
        `INSERT INTO photos (id, owner_user_id, job_id, stage, checklist_item_id, source, taken_at, taken_at_source,
           original_path, original_width, original_height, original_bytes, sync_state, deleted, created_at, recovered)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'saved', 0, ?, ?)`,
        [p.id, p.ownerUserId, p.jobId, p.stage, p.checklistItemId ?? null, p.source, p.takenAt, p.takenAtSource, p.originalPath, p.width, p.height, p.bytes, p.createdAt, p.recovered ? 1 : 0],
      );
    });
    this.changed();
  }

  get(ownerUserId: string, id: string): PhotoRow | undefined {
    return this.db.get<PhotoRow>("SELECT * FROM photos WHERE owner_user_id = ? AND id = ?", [ownerUserId, id]);
  }

  /** Live (not deleted) photos of one job, oldest first. */
  listForJob(ownerUserId: string, jobId: string): PhotoRow[] {
    return this.db.all<PhotoRow>("SELECT * FROM photos WHERE owner_user_id = ? AND job_id = ? AND deleted = 0 ORDER BY taken_at, created_at, id", [ownerUserId, jobId]);
  }

  countForJob(ownerUserId: string, jobId: string): number {
    return this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM photos WHERE owner_user_id = ? AND job_id = ? AND deleted = 0", [ownerUserId, jobId])?.n ?? 0;
  }

  countForItem(ownerUserId: string, jobId: string, itemId: string): number {
    return (
      this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM photos WHERE owner_user_id = ? AND job_id = ? AND checklist_item_id = ? AND deleted = 0", [ownerUserId, jobId, itemId])?.n ?? 0
    );
  }

  /** Local report state, or undefined when the job has no local draft. */
  reportState(ownerUserId: string, jobId: string): LocalReportState | undefined {
    return this.db.get<{ local_state: LocalReportState }>("SELECT local_state FROM drafts WHERE owner_user_id = ? AND job_id = ?", [ownerUserId, jobId])?.local_state;
  }

  /** Stage and caption may change until the report is submitted (or queued to submit). */
  isEditable(ownerUserId: string, jobId: string): boolean {
    const s = this.reportState(ownerUserId, jobId);
    return s === undefined || s === "draft" || s === "rejected";
  }

  private edit(ownerUserId: string, id: string, set: string, value: string | null): void {
    const photo = this.get(ownerUserId, id);
    if (!photo || photo.deleted) return;
    if (!this.isEditable(ownerUserId, photo.job_id)) throw new PhotoLockedError();
    this.db.run(`UPDATE photos SET ${set}, meta_rev = meta_rev + 1 WHERE owner_user_id = ? AND id = ?`, [value, ownerUserId, id]);
    this.changed();
  }

  setStage(ownerUserId: string, id: string, stage: Stage): void {
    this.edit(ownerUserId, id, "stage = ?", stage);
  }

  setCaption(ownerUserId: string, id: string, caption: string | null): void {
    this.edit(ownerUserId, id, "caption = ?", caption);
  }

  setThumb(ownerUserId: string, id: string, thumbPath: string): void {
    this.db.run("UPDATE photos SET thumb_path = ? WHERE owner_user_id = ? AND id = ? AND deleted = 0", [thumbPath, ownerUserId, id]);
    this.changed();
  }

  /** Step 1 of deleting: the flag is committed before any file is touched, so a kill cannot half-delete. */
  markDeleted(ownerUserId: string, id: string): PhotoRow | undefined {
    const photo = this.get(ownerUserId, id);
    if (!photo) return undefined;
    if (!this.isEditable(ownerUserId, photo.job_id)) throw new PhotoLockedError();
    this.db.run("UPDATE photos SET deleted = 1, meta_rev = meta_rev + 1 WHERE owner_user_id = ? AND id = ?", [ownerUserId, id]);
    this.changed();
    return { ...photo, deleted: 1 };
  }

  /** Last step of deleting a photo the server never had. */
  purge(ownerUserId: string, id: string): void {
    this.db.run("DELETE FROM photos WHERE owner_user_id = ? AND id = ? AND deleted = 1", [ownerUserId, id]);
    this.changed();
  }

  /** Deleted rows with no server copy whose files may still need removing (a kill part-way through deleting). */
  pendingLocalDeletes(ownerUserId: string): PhotoRow[] {
    return this.db.all<PhotoRow>("SELECT * FROM photos WHERE owner_user_id = ? AND deleted = 1 AND sync_state = 'saved'", [ownerUserId]);
  }

  /** Every photo id the user has a row for, deleted or not: a file with such an id is never an orphan. */
  knownIds(ownerUserId: string): Set<string> {
    return new Set(this.db.all<{ id: string }>("SELECT id FROM photos WHERE owner_user_id = ?", [ownerUserId]).map((r) => r.id));
  }

  /** Is any other user's row using this id? (Ids are UUIDs, so this only guards against corruption.) */
  idTaken(id: string): boolean {
    return this.db.get("SELECT 1 AS x FROM photos WHERE id = ?", [id]) !== undefined;
  }

  getMeta(key: string): string | undefined {
    return this.db.get<{ value: string }>("SELECT value FROM sync_meta WHERE key = ?", [key])?.value;
  }

  setMeta(key: string, value: string): void {
    this.db.run("INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]);
  }

  lastStage(ownerUserId: string): Stage {
    const s = this.getMeta(`last_stage:${ownerUserId}`);
    return (STAGES as readonly string[]).includes(s ?? "") ? (s as Stage) : "before";
  }

  setLastStage(ownerUserId: string, stage: Stage): void {
    this.setMeta(`last_stage:${ownerUserId}`, stage);
  }

  /** The job the camera was last opened for: lets recovery attach a file whose row was never written. */
  captureIntent(ownerUserId: string): string | undefined {
    return this.getMeta(`capture_job:${ownerUserId}`);
  }

  setCaptureIntent(ownerUserId: string, jobId: string): void {
    this.setMeta(`capture_job:${ownerUserId}`, jobId);
  }
}
