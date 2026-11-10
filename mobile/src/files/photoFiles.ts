/**
 * PhotoFiles: the one door to app-private photo storage (design 3.3/3.6, T-003e Patterns).
 * The app uses ExpoPhotoFiles over expo-file-system; tests use an in-memory fake with the same
 * contract. Paths held in the database are RELATIVE to the app's document directory (see
 * paths.ts), so a changed install location can never strand a photo.
 */
export interface PhotoFiles {
  ensureDir(dirRel: string): void;
  exists(rel: string): boolean;
  /** Size in bytes, or null when the file is missing. */
  size(rel: string): number | null;
  /** Last-modified time in ms since the epoch, or null. */
  modifiedAt(rel: string): number | null;
  /** The file names (not folders) directly inside `dirRel`; empty when the folder is missing. */
  list(dirRel: string): string[];
  /** A rename from outside the store (the camera's cache file) into it. Fails if the destination exists. */
  moveTo(srcUri: string, destRel: string): Promise<void>;
  /** A copy from outside the store (a gallery file). The source is never touched. */
  copyTo(srcUri: string, destRel: string): Promise<void>;
  /** Renames inside one folder: the atomic last step of a copy. */
  rename(fromRel: string, toName: string): void;
  /** Idempotent: deleting a missing file is not an error. */
  remove(rel: string): void;
  /** A URI an <Image> can show. */
  uri(rel: string): string;
  /** Free space on the phone's storage, in bytes. */
  availableBytes(): number;
  /** Lower-case hex SHA-256 of the file's bytes. */
  sha256(rel: string): Promise<string>;
}

/**
 * Copy then rename: the final name only ever refers to a complete file (a kill mid-copy leaves a
 * `.part` file that startup cleanup deletes). Used for gallery files, whose source stays put.
 */
export async function copyAtomically(files: PhotoFiles, srcUri: string, destRel: string): Promise<void> {
  const part = `${destRel}.part`;
  const slash = destRel.lastIndexOf("/");
  const name = destRel.slice(slash + 1);
  try {
    files.remove(part);
    await files.copyTo(srcUri, part);
    files.rename(part, name);
  } catch (error) {
    files.remove(part);
    throw error;
  }
}
