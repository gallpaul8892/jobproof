import type { LocalDb } from "../db/localDb";
import type { PhotoRow } from "../db/photoRepo";
import type { PhotoFiles } from "../files/photoFiles";
import { uploadDir, uploadPath } from "../files/paths";
import { UPLOAD_JPEG_QUALITY, UPLOAD_MAX_EDGE, type ImageTools } from "./imageTools";

export interface UploadCopy {
  path: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}

/**
 * The smaller JPEG that is actually sent (design 3.6 step 8): long edge at most 2560 px, quality
 * 0.8, no EXIF, HEIC/PNG converted. The original is never touched.
 *
 * Made ONCE and then reused: its path, size and SHA-256 are saved in the photo's row before the
 * photo is registered with the server. A second encode after a crash would give different bytes
 * for the same photo id, which the server refuses (`photo_content_mismatch`). The sync engine
 * (T-003g) calls this; the capture screens do not.
 */
export async function ensureUploadCopy(deps: { db: LocalDb; files: PhotoFiles; tools: ImageTools }, photo: PhotoRow): Promise<UploadCopy> {
  const { db, files, tools } = deps;
  const rel = uploadPath(photo.owner_user_id, photo.id);
  const stored = db.get<{ upload_path: string | null; upload_width: number | null; upload_height: number | null; upload_bytes: number | null; upload_sha256: string | null }>(
    "SELECT upload_path, upload_width, upload_height, upload_bytes, upload_sha256 FROM photos WHERE owner_user_id = ? AND id = ?",
    [photo.owner_user_id, photo.id],
  );
  if (stored?.upload_path && stored.upload_sha256 && files.exists(stored.upload_path)) {
    return { path: stored.upload_path, width: stored.upload_width ?? 0, height: stored.upload_height ?? 0, bytes: stored.upload_bytes ?? 0, sha256: stored.upload_sha256 };
  }
  if (!files.exists(photo.original_path)) throw new Error("The original photo file is missing.");
  const resized = await tools.resizeToJpeg(files.uri(photo.original_path), { maxEdge: UPLOAD_MAX_EDGE, quality: UPLOAD_JPEG_QUALITY });
  files.ensureDir(uploadDir(photo.owner_user_id));
  files.remove(rel);
  await files.moveTo(resized.uri, rel);
  const bytes = files.size(rel) ?? 0;
  const sha256 = await files.sha256(rel);
  db.run(
    "UPDATE photos SET upload_path = ?, upload_width = ?, upload_height = ?, upload_bytes = ?, upload_sha256 = ? WHERE owner_user_id = ? AND id = ? AND sync_state = 'saved'",
    [rel, resized.width, resized.height, bytes, sha256, photo.owner_user_id, photo.id],
  );
  return { path: rel, width: resized.width, height: resized.height, bytes, sha256 };
}
