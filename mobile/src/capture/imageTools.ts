/**
 * ImageTools: resizing and re-encoding, behind an interface so logic tests need no native code
 * (the real one is expoImageTools.ts over expo-image-manipulator, SDK 58).
 */
export interface ResizedImage {
  /** A temporary file the caller must move into the store. */
  uri: string;
  width: number;
  height: number;
}

export interface ImageTools {
  /**
   * Re-encodes as JPEG with the long edge at most `maxEdge` px (never enlarging). The result has
   * no EXIF, and its pixels are already upright: the source's EXIF orientation is applied.
   */
  resizeToJpeg(sourceUri: string, options: { maxEdge: number; quality: number }): Promise<ResizedImage>;
}

/** Upload copy limits (design 3.6 step 8, NFR-1). */
export const UPLOAD_MAX_EDGE = 2560;
export const UPLOAD_JPEG_QUALITY = 0.8;
/** Preview size for lists. */
export const THUMB_MAX_EDGE = 480;
export const THUMB_JPEG_QUALITY = 0.7;

/** The size that fits `maxEdge` and keeps the shape; the same size when already small enough. */
export function fitLongEdge(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width, height };
  const scale = maxEdge / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
