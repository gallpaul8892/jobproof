/**
 * Where photos live (design 3.3). All relative to the app's private document directory:
 *   photos/<userId>/<photoId>.jpg            full-size original, exactly as the camera or gallery gave it
 *   photos/<userId>/thumbs/<photoId>.jpg     small preview, derived (safe to delete and rebuild)
 *   photos/<userId>/upload/<photoId>.jpg     the smaller copy that is sent (made once, T-003g)
 * Never in the phone's gallery: the folder is app-private and the app holds no media permission.
 */
export const PHOTOS_ROOT = "photos";
export const PART_SUFFIX = ".part";

const SAFE_SEGMENT = /^[A-Za-z0-9-]{1,64}$/;
const ORIGINAL_EXTENSIONS = ["jpg", "png", "heic", "heif", "webp"] as const;
export type OriginalExtension = (typeof ORIGINAL_EXTENSIONS)[number];
const FILE_NAME = /^([A-Za-z0-9-]{8,64})\.(jpg|png|heic|heif|webp)$/;

function safe(segment: string): string {
  if (!SAFE_SEGMENT.test(segment)) throw new Error("Unsafe path segment.");
  return segment;
}

export const userDir = (userId: string): string => `${PHOTOS_ROOT}/${safe(userId)}`;
export const thumbsDir = (userId: string): string => `${userDir(userId)}/thumbs`;
export const uploadDir = (userId: string): string => `${userDir(userId)}/upload`;
export const originalPath = (userId: string, photoId: string, ext: OriginalExtension = "jpg"): string => `${userDir(userId)}/${safe(photoId)}.${ext}`;
export const thumbPath = (userId: string, photoId: string): string => `${thumbsDir(userId)}/${safe(photoId)}.jpg`;
export const uploadPath = (userId: string, photoId: string): string => `${uploadDir(userId)}/${safe(photoId)}.jpg`;

/** The photo id and extension in an original's file name, or null for anything that is not one (such files are left alone). */
export function parseOriginalName(name: string): { id: string; ext: OriginalExtension } | null {
  const m = FILE_NAME.exec(name);
  return m ? { id: m[1]!, ext: m[2] as OriginalExtension } : null;
}

/** Picks the stored extension from what the source says it is; JPEG when unsure (the camera always gives JPEG). */
export function extensionFor(mimeType: string | undefined, uri: string): OriginalExtension {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime === "image/png") return "png";
  if (mime === "image/heic") return "heic";
  if (mime === "image/heif") return "heif";
  if (mime === "image/webp") return "webp";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  const m = /\.([A-Za-z0-9]{3,4})(?:\?|#|$)/.exec(uri);
  const ext = m?.[1]?.toLowerCase();
  return (ORIGINAL_EXTENSIONS as readonly string[]).includes(ext ?? "") ? (ext as OriginalExtension) : "jpg";
}
