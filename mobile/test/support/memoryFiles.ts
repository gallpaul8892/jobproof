import { createHash } from "node:crypto";
import type { PhotoFiles } from "../../src/files/photoFiles";

const ROOT = "file:///app/";

/** An in-memory PhotoFiles. Files outside the store (camera cache, gallery) are added with `seed(uri, ...)`. */
export class MemoryPhotoFiles implements PhotoFiles {
  readonly entries = new Map<string, { bytes: Uint8Array; mtime: number }>();
  free = 10 * 1024 * 1024 * 1024;
  /** Make the next call to a method throw (one shot), to simulate a failing disk. */
  failNext: "moveTo" | "copyTo" | "rename" | undefined;
  clock = 1_700_000_000_000;

  seed(uri: string, content = "jpeg-bytes", mtime = this.clock): string {
    this.entries.set(uri, { bytes: new TextEncoder().encode(content), mtime });
    return uri;
  }
  private key = (rel: string) => `${ROOT}${rel}`;
  private fail(op: "moveTo" | "copyTo" | "rename") {
    if (this.failNext === op) {
      this.failNext = undefined;
      throw new Error(`${op} failed`);
    }
  }
  ensureDir(): void {}
  exists(rel: string) {
    return this.entries.has(this.key(rel));
  }
  size(rel: string) {
    return this.entries.get(this.key(rel))?.bytes.length ?? null;
  }
  modifiedAt(rel: string) {
    return this.entries.get(this.key(rel))?.mtime ?? null;
  }
  list(dirRel: string) {
    const prefix = this.key(`${dirRel}/`);
    return [...this.entries.keys()].filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/")).map((k) => k.slice(prefix.length));
  }
  async moveTo(srcUri: string, destRel: string) {
    this.fail("moveTo");
    const e = this.entries.get(srcUri);
    if (!e) throw new Error("source missing");
    if (this.exists(destRel)) throw new Error("destination exists");
    this.entries.set(this.key(destRel), e);
    this.entries.delete(srcUri);
  }
  async copyTo(srcUri: string, destRel: string) {
    this.fail("copyTo");
    const e = this.entries.get(srcUri);
    if (!e) throw new Error("source missing");
    this.entries.set(this.key(destRel), { bytes: e.bytes.slice(), mtime: this.clock });
  }
  rename(fromRel: string, toName: string) {
    this.fail("rename");
    const from = this.key(fromRel);
    const e = this.entries.get(from);
    if (!e) throw new Error("rename source missing");
    const dir = fromRel.slice(0, fromRel.lastIndexOf("/"));
    this.entries.delete(from);
    this.entries.set(this.key(`${dir}/${toName}`), e);
  }
  remove(rel: string) {
    this.entries.delete(this.key(rel));
  }
  uri(rel: string) {
    return this.key(rel);
  }
  availableBytes() {
    return this.free;
  }
  async sha256(rel: string) {
    const e = this.entries.get(this.key(rel));
    if (!e) throw new Error("missing");
    return createHash("sha256").update(e.bytes).digest("hex");
  }
}

export const MB = 1024 * 1024;
