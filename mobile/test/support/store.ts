import { createLocalStore, type LocalStore } from "../../src/db/localStore";
import type { LocalDb } from "../../src/db/localDb";
import { FakeImageTools, FakePicker } from "./fakes";
import { MemoryPhotoFiles } from "./memoryFiles";
import { openTestDb } from "./nodeSqliteDb";

export interface TestStore {
  store: LocalStore;
  db: LocalDb;
  files: MemoryPhotoFiles;
  tools: FakeImageTools;
  picker: FakePicker;
}

/** Ids that read well in failures: 00000000-0000-4000-8000-000000000001, ... */
export function sequentialIds(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

/** The real store over node:sqlite and in-memory files. Pass `db`/`files` to "restart the app" over the same storage. */
export function makeTestStore(over: { db?: LocalDb; files?: MemoryPhotoFiles; now?: () => Date; newId?: () => string } = {}): TestStore {
  const db = over.db ?? openTestDb();
  const files = over.files ?? new MemoryPhotoFiles();
  const tools = new FakeImageTools(files);
  const picker = new FakePicker();
  const store = createLocalStore({ db, files, tools, picker, now: over.now ?? (() => new Date("2026-11-09T08:14:00Z")), newId: over.newId ?? sequentialIds() });
  return { store, db, files, tools, picker };
}
