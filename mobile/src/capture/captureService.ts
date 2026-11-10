import { randomUuid } from "../api/uuid";
import {
  MAX_PHOTOS_PER_ITEM,
  MAX_PHOTOS_PER_REPORT,
  type PhotoRepo,
  type PhotoRow,
  type Stage,
} from "../db/photoRepo";
import { copyAtomically, type PhotoFiles } from "../files/photoFiles";
import { extensionFor, originalPath, thumbPath, thumbsDir, type OriginalExtension } from "../files/paths";
import { parseExifTakenAt } from "./exif";
import type { PickedAsset } from "./gallery";
import { THUMB_JPEG_QUALITY, THUMB_MAX_EDGE, type ImageTools } from "./imageTools";
import { CAPTURE_MSG, filesSkipped, photosAdded } from "./messages";

const MB = 1024 * 1024;
/** NFR-8: warn under 500 MB, refuse under 100 MB. */
export const LOW_STORAGE_BYTES = 500 * MB;
export const MIN_STORAGE_BYTES = 100 * MB;

export type StorageStatus = "ok" | "low" | "full";

export interface CaptureTarget {
  ownerUserId: string;
  jobId: string;
  stage: Stage;
  /** The checklist item the photo is for, if any (12 per item). */
  itemId?: string | null;
}

export type Refusal = { ok: false; reason: "report_full" | "item_full" | "locked" | "no_space"; message: string };
export type Room = { ok: true; remaining: number } | Refusal;

/** What the camera hands over when the shutter resolves. */
export interface Shot {
  uri: string;
  width: number;
  height: number;
}

export type SaveResult = { ok: true; photo: PhotoRow } | Refusal | { ok: false; reason: "failed"; message: string };

export interface ImportSummary {
  added: number;
  skipped: number;
  /** Set when some picks were left out because a limit was reached. */
  limit: string | null;
  message: string;
}

export interface CaptureDeps {
  repo: PhotoRepo;
  files: PhotoFiles;
  tools: ImageTools;
  now?: () => Date;
  newId?: () => string;
}

/**
 * Saves photos on the phone. The one rule (design 3.6): once `saveShot` resolves, the photo is a
 * complete file in app-private storage AND a committed row. The order is
 *   1. rename the camera's file into `photos/<user>/<id>.jpg` (atomic, same folder tree);
 *   2. insert the row (and the job's draft) in one transaction with synchronous=FULL.
 * A kill between 1 and 2 leaves a file with no row, which startup cleanup turns into a row.
 */
export class PhotoCapture {
  private readonly repo: PhotoRepo;
  private readonly files: PhotoFiles;
  private readonly tools: ImageTools;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly background = new Set<Promise<void>>();

  constructor(deps: CaptureDeps) {
    this.repo = deps.repo;
    this.files = deps.files;
    this.tools = deps.tools;
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? randomUuid;
  }

  storageStatus(): StorageStatus {
    const free = this.files.availableBytes();
    return free < MIN_STORAGE_BYTES ? "full" : free < LOW_STORAGE_BYTES ? "low" : "ok";
  }

  /** Can `adding` more photos go on this job (and item) right now? Counts live rows only. */
  room(target: CaptureTarget, adding = 1): Room {
    const { ownerUserId, jobId, itemId } = target;
    const state = this.repo.reportState(ownerUserId, jobId);
    if (state === "submitted" || state === "submit_queued") return { ok: false, reason: "locked", message: CAPTURE_MSG.locked };
    if (this.storageStatus() === "full") return { ok: false, reason: "no_space", message: CAPTURE_MSG.storageFull };
    const reportLeft = MAX_PHOTOS_PER_REPORT - this.repo.countForJob(ownerUserId, jobId);
    const itemLeft = itemId ? MAX_PHOTOS_PER_ITEM - this.repo.countForItem(ownerUserId, jobId, itemId) : Infinity;
    // The item limit is reported first when both are reached: it is the one the operative can act on.
    if (itemLeft < adding && itemLeft <= reportLeft) return { ok: false, reason: "item_full", message: CAPTURE_MSG.itemFull };
    if (reportLeft < adding) return { ok: false, reason: "report_full", message: CAPTURE_MSG.reportFull };
    return { ok: true, remaining: Math.min(reportLeft, itemLeft) };
  }

  /** Saves one camera shot. The target is read when the shutter is pressed, so switching jobs afterwards cannot move the photo. */
  async saveShot(target: CaptureTarget, shot: Shot): Promise<SaveResult> {
    const room = this.room(target);
    if (!room.ok) return room;
    const id = this.newId();
    const rel = originalPath(target.ownerUserId, id, "jpg");
    try {
      await this.files.moveTo(shot.uri, rel);
      this.repo.setLastStage(target.ownerUserId, target.stage);
      this.repo.insert({
        id,
        ownerUserId: target.ownerUserId,
        jobId: target.jobId,
        stage: target.stage,
        checklistItemId: target.itemId ?? null,
        source: "camera",
        takenAt: this.now().toISOString(),
        takenAtSource: "device_clock",
        originalPath: rel,
        width: shot.width,
        height: shot.height,
        bytes: this.files.size(rel),
        createdAt: this.now().toISOString(),
      });
    } catch {
      // The file (if it moved) stays: startup cleanup recovers it. Never delete the only copy.
      return { ok: false, reason: "failed", message: CAPTURE_MSG.saveFailed };
    }
    const photo = this.repo.get(target.ownerUserId, id)!;
    this.scheduleThumb(photo);
    return { ok: true, photo };
  }

  /**
   * Adds picked gallery items. Each is COPIED (a copy is written under a temporary name, then
   * renamed) so the evidence survives the operative deleting it from the gallery. Anything that
   * is not a readable image is skipped and counted; the rest are added.
   */
  async importAssets(target: CaptureTarget, assets: readonly PickedAsset[]): Promise<ImportSummary> {
    const room = this.room(target);
    if (!room.ok) return { added: 0, skipped: 0, limit: room.message, message: room.message };
    let remaining = room.remaining;
    let added = 0;
    let skipped = 0;
    let limit: string | null = null;
    for (const asset of assets) {
      if (remaining <= 0) {
        const again = this.room(target);
        limit = again.ok ? CAPTURE_MSG.reportFull : again.message;
        break;
      }
      const ok = await this.importOne(target, asset);
      if (ok) {
        added += 1;
        remaining -= 1;
      } else {
        skipped += 1;
      }
    }
    this.repo.setLastStage(target.ownerUserId, target.stage);
    const parts: string[] = [];
    if (added > 0) parts.push(`${photosAdded(added)}.`);
    if (skipped > 0) parts.push(`${filesSkipped(skipped)}.`);
    if (limit) parts.push(limit);
    return { added, skipped, limit, message: parts.join(" ") };
  }

  private async importOne(target: CaptureTarget, asset: PickedAsset): Promise<boolean> {
    const isImage = asset.type ? asset.type === "image" : (asset.mimeType ?? "image/").startsWith("image/");
    if (!isImage || !asset.uri) return false;
    const id = this.newId();
    const ext: OriginalExtension = extensionFor(asset.mimeType, asset.uri);
    const rel = originalPath(target.ownerUserId, id, ext);
    try {
      await copyAtomically(this.files, asset.uri, rel);
    } catch {
      return false;
    }
    const bytes = this.files.size(rel);
    if (!bytes) {
      this.files.remove(rel);
      return false;
    }
    const taken = parseExifTakenAt(asset.exif);
    try {
      this.repo.insert({
        id,
        ownerUserId: target.ownerUserId,
        jobId: target.jobId,
        stage: target.stage,
        checklistItemId: target.itemId ?? null,
        source: "gallery",
        takenAt: taken ?? this.now().toISOString(),
        takenAtSource: taken ? "file_metadata" : "added_time",
        originalPath: rel,
        width: asset.width ?? null,
        height: asset.height ?? null,
        bytes,
        createdAt: this.now().toISOString(),
      });
    } catch {
      this.files.remove(rel); // the gallery still has the original; nothing is lost
      return false;
    }
    this.scheduleThumb(this.repo.get(target.ownerUserId, id)!);
    return true;
  }

  /**
   * Deletes a photo the operative no longer wants (T-003e scenario 9). The flag is committed
   * first. With no server copy the files go too; with one (registered or sent) the files stay
   * until the sync engine has told the server (T-003g).
   */
  async deletePhoto(ownerUserId: string, photoId: string): Promise<"deleted" | "kept_for_sync" | "missing"> {
    const marked = this.repo.markDeleted(ownerUserId, photoId);
    if (!marked) return "missing";
    if (marked.sync_state !== "saved") return "kept_for_sync";
    this.files.remove(marked.original_path);
    if (marked.thumb_path) this.files.remove(marked.thumb_path);
    if (marked.upload_path) this.files.remove(marked.upload_path);
    this.repo.purge(ownerUserId, photoId);
    return "deleted";
  }

  /** Resolves when all background preview work has finished (tests wait on this). */
  idle(): Promise<void> {
    return Promise.all([...this.background]).then(() => undefined);
  }

  private scheduleThumb(photo: PhotoRow): void {
    const work = this.makeThumb(photo)
      .catch(() => undefined) // a missing preview only means the full image is shown
      .finally(() => this.background.delete(work));
    this.background.add(work);
  }

  /** A small preview so lists do not decode 12 MP images. Derived: safe to lose and rebuild. */
  async makeThumb(photo: PhotoRow): Promise<void> {
    const rel = thumbPath(photo.owner_user_id, photo.id);
    const resized = await this.tools.resizeToJpeg(this.files.uri(photo.original_path), { maxEdge: THUMB_MAX_EDGE, quality: THUMB_JPEG_QUALITY });
    this.files.ensureDir(thumbsDir(photo.owner_user_id));
    this.files.remove(rel);
    await this.files.moveTo(resized.uri, rel);
    const current = this.repo.get(photo.owner_user_id, photo.id);
    if (!current || current.deleted) {
      this.files.remove(rel); // deleted while the preview was being made
      return;
    }
    this.repo.setThumb(photo.owner_user_id, photo.id, rel);
  }
}
