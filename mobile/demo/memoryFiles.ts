import type { PhotoFiles } from "../src/files/photoFiles";

interface Entry {
  dataUrl: string;
  bytes: number;
  mtime: number;
}

const DATA_URL = /^data:([^;,]*)(;base64)?,(.*)$/s;

/** Decodes a data URL to bytes. Anything else (a file path, a web address) is refused: the demo only ever holds data URLs. */
export function dataUrlBytes(uri: string): Uint8Array {
  const m = DATA_URL.exec(uri);
  if (!m) throw new Error("The demo can only read pictures it made itself.");
  if (m[2]) {
    const binary = atob(m[3]!);
    return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  }
  return new TextEncoder().encode(decodeURIComponent(m[3]!));
}

/** PhotoFiles for the browser demo: pictures live in memory as data URLs, so an <Image> can show them. Gone on reload. */
export class MemoryDemoFiles implements PhotoFiles {
  private readonly entries = new Map<string, Entry>();
  /** Pretend storage: plenty, so the demo never shows the "storage low" banner. */
  free = 8 * 1024 * 1024 * 1024;

  constructor(private readonly now: () => number = Date.now) {}

  private read(srcUri: string): Entry {
    return { dataUrl: srcUri, bytes: dataUrlBytes(srcUri).length, mtime: this.now() };
  }

  ensureDir(): void {
    // Folders are implied by the file names.
  }
  exists(rel: string) {
    return this.entries.has(rel);
  }
  size(rel: string) {
    return this.entries.get(rel)?.bytes ?? null;
  }
  modifiedAt(rel: string) {
    return this.entries.get(rel)?.mtime ?? null;
  }
  list(dirRel: string) {
    const prefix = `${dirRel}/`;
    return [...this.entries.keys()].filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/")).map((k) => k.slice(prefix.length));
  }
  async moveTo(srcUri: string, destRel: string) {
    if (this.entries.has(destRel)) throw new Error("destination exists");
    this.entries.set(destRel, this.read(srcUri));
  }
  async copyTo(srcUri: string, destRel: string) {
    this.entries.set(destRel, this.read(srcUri));
  }
  rename(fromRel: string, toName: string) {
    const entry = this.entries.get(fromRel);
    if (!entry) throw new Error("rename source missing");
    const dir = fromRel.slice(0, fromRel.lastIndexOf("/"));
    this.entries.delete(fromRel);
    this.entries.set(`${dir}/${toName}`, entry);
  }
  remove(rel: string) {
    this.entries.delete(rel);
  }
  uri(rel: string) {
    return this.entries.get(rel)?.dataUrl ?? "";
  }
  availableBytes() {
    return this.free;
  }
  async sha256(rel: string) {
    const entry = this.entries.get(rel);
    if (!entry) throw new Error("missing");
    const bytes = dataUrlBytes(entry.dataUrl);
    const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
}
