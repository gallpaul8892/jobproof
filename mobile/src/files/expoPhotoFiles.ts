import { Directory, File, Paths } from "expo-file-system";
import type { PhotoFiles } from "./photoFiles";

const doc = (rel: string) => new File(Paths.document, rel);

/** PhotoFiles over expo-file-system's File/Directory API (SDK 58). */
export class ExpoPhotoFiles implements PhotoFiles {
  ensureDir(dirRel: string): void {
    new Directory(Paths.document, dirRel).create({ intermediates: true, idempotent: true });
  }
  exists(rel: string): boolean {
    return doc(rel).exists;
  }
  size(rel: string): number | null {
    const f = doc(rel);
    return f.exists ? f.size : null;
  }
  modifiedAt(rel: string): number | null {
    const f = doc(rel);
    return f.exists ? (f.modificationTime ?? null) : null;
  }
  list(dirRel: string): string[] {
    const dir = new Directory(Paths.document, dirRel);
    if (!dir.exists) return [];
    return dir
      .list()
      .filter((e): e is File => e instanceof File)
      .map((f) => f.name);
  }
  async moveTo(srcUri: string, destRel: string): Promise<void> {
    this.ensureDir(destRel.slice(0, destRel.lastIndexOf("/")));
    await new File(srcUri).move(doc(destRel));
  }
  async copyTo(srcUri: string, destRel: string): Promise<void> {
    this.ensureDir(destRel.slice(0, destRel.lastIndexOf("/")));
    await new File(srcUri).copy(doc(destRel));
  }
  rename(fromRel: string, toName: string): void {
    doc(fromRel).rename(toName);
  }
  remove(rel: string): void {
    const f = doc(rel);
    if (f.exists) f.delete();
  }
  uri(rel: string): string {
    return doc(rel).uri;
  }
  availableBytes(): number {
    return Paths.availableDiskSpace;
  }
  sha256(rel: string): Promise<string> {
    return doc(rel).digest("SHA-256");
  }
}
