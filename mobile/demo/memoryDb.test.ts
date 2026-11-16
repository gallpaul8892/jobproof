import { applyPragmas, migrate, schemaVersion, LATEST_VERSION } from "../src/db/migrations";
import { PhotoRepo, PhotoLockedError, type NewPhoto } from "../src/db/photoRepo";
import { SqliteUnsentItemsSource } from "../src/db/unsentSource";
import type { LocalDb } from "../src/db/localDb";
import { openTestDb } from "../test/support/nodeSqliteDb";
import { MemoryDb } from "./memoryDb";

function openMemory(): MemoryDb {
  const db = new MemoryDb();
  applyPragmas(db);
  migrate(db);
  return db;
}

const photo = (over: Partial<NewPhoto> = {}): NewPhoto => ({
  id: "photo-0001",
  ownerUserId: "dan",
  jobId: "job-a",
  stage: "before",
  source: "camera",
  takenAt: "2026-11-09T08:14:00.000Z",
  takenAtSource: "device_clock",
  originalPath: "photos/dan/photo-0001.jpg",
  width: 4000,
  height: 3000,
  bytes: 10,
  createdAt: "2026-11-09T08:14:00.000Z",
  ...over,
});

/**
 * Drives the app's real repositories through a long scenario and returns everything they say.
 * Run over node:sqlite (the reference) and over MemoryDb: the answers must be identical.
 */
function scenario(db: LocalDb): unknown[] {
  const out: unknown[] = [];
  const repo = new PhotoRepo(db);
  const unsent = new SqliteUnsentItemsSource(db);
  const attempt = (fn: () => unknown) => {
    try {
      return fn();
    } catch (e) {
      return `threw ${(e as Error).constructor.name}`;
    }
  };
  out.push(repo.reportState("dan", "job-a"), unsent.summaryFor("dan"));
  repo.insert(photo());
  repo.insert(photo({ id: "photo-0002", takenAt: "2026-11-09T08:10:00.000Z", checklistItemId: "item-1", stage: "during" }));
  repo.insert(photo({ id: "photo-0003", jobId: "job-b", originalPath: "photos/dan/photo-0003.jpg" }));
  repo.insert(photo({ id: "photo-0004", ownerUserId: "priya", originalPath: "photos/priya/photo-0004.jpg" }));
  out.push(attempt(() => repo.insert(photo({ id: "photo-0005", stage: "nope" as never }))), repo.knownIds("dan"));
  out.push(attempt(() => repo.insert(photo())), repo.reportState("dan", "job-a"));
  out.push(repo.listForJob("dan", "job-a"), repo.get("dan", "photo-0002"), repo.get("priya", "photo-0002"));
  out.push(repo.countForJob("dan", "job-a"), repo.countForItem("dan", "job-a", "item-1"), repo.idTaken("photo-0004"), repo.idTaken("nope"));
  repo.setStage("dan", "photo-0001", "after");
  repo.setCaption("dan", "photo-0001", "Finished wall");
  repo.setThumb("dan", "photo-0001", "photos/dan/thumbs/photo-0001.jpg");
  out.push(repo.get("dan", "photo-0001"));
  out.push(repo.lastStage("dan"), (repo.setLastStage("dan", "during"), repo.lastStage("dan")), (repo.setLastStage("dan", "after"), repo.lastStage("dan")));
  repo.setCaptureIntent("dan", "job-b");
  out.push(repo.captureIntent("dan"), repo.captureIntent("priya"), repo.getMeta("nothing"));
  out.push(unsent.summaryFor("dan"), unsent.summaryFor("priya"));
  out.push(repo.markDeleted("dan", "photo-0003"), repo.pendingLocalDeletes("dan"), unsent.summaryFor("dan"));
  repo.purge("dan", "photo-0003");
  out.push(repo.get("dan", "photo-0003"), repo.countForJob("dan", "job-b"));
  // Draft state and checklist rows drive the "reports" half of the unsent count.
  db.run("UPDATE drafts SET notes_rev = notes_rev + 1 WHERE owner_user_id = ? AND job_id = ?", ["dan", "job-a"]);
  db.run("INSERT INTO checklist_states (owner_user_id, job_id, item_id, rev) VALUES (?, ?, ?, 2)", ["dan", "job-c", "i1"]);
  out.push(unsent.summaryFor("dan"));
  db.run("UPDATE drafts SET local_state = 'submit_queued' WHERE owner_user_id = ? AND job_id = ?", ["dan", "job-a"]);
  out.push(repo.isEditable("dan", "job-a"), attempt(() => repo.setStage("dan", "photo-0001", "before")), attempt(() => repo.markDeleted("dan", "photo-0001")));
  // A rolled-back transaction leaves nothing behind, and a nested failure undoes only the inner part.
  out.push(
    attempt(() =>
      db.transaction(() => {
        db.run("INSERT OR IGNORE INTO drafts (owner_user_id, job_id) VALUES (?, ?)", ["dan", "job-z"]);
        throw new Error("boom");
      }),
    ),
    repo.reportState("dan", "job-z"),
  );
  db.transaction(() => {
    db.run("INSERT OR IGNORE INTO drafts (owner_user_id, job_id) VALUES (?, ?)", ["dan", "job-y"]);
    attempt(() =>
      db.transaction(() => {
        db.run("INSERT OR IGNORE INTO drafts (owner_user_id, job_id) VALUES (?, ?)", ["dan", "job-x"]);
        throw new Error("inner");
      }),
    );
  });
  out.push(repo.reportState("dan", "job-y"), repo.reportState("dan", "job-x"));
  out.push(db.run("DELETE FROM photos WHERE owner_user_id = ?", ["priya"]).changes, repo.knownIds("priya"));
  return out;
}

describe("MemoryDb", () => {
  it("answers exactly like SQLite for everything the app's repositories do", () => {
    const reference = scenario(openTestDb());
    const memory = scenario(openMemory());
    expect(memory).toEqual(reference);
    expect(JSON.stringify(reference)).toContain("PhotoLockedError"); // the scenario does reach the locked path
  });

  it("migrates to the newest schema and remembers user_version", () => {
    const db = openMemory();
    expect(schemaVersion(db)).toBe(LATEST_VERSION);
    expect(migrate(db)).toBe(LATEST_VERSION); // running again changes nothing
  });

  it("refuses SQL outside the dialect the app uses, instead of guessing", () => {
    const db = openMemory();
    expect(() => db.exec("DROP TABLE photos")).toThrow(/not supported/);
    expect(() => db.all("SELECT * FROM missing")).toThrow(/no such table/);
    expect(() => db.run("INSERT INTO photos (nope) VALUES (1)")).toThrow(/no such column/);
  });

  it("keeps its state in memory only: a new instance starts empty", () => {
    const first = openMemory();
    new PhotoRepo(first).insert(photo());
    expect(new PhotoRepo(openMemory()).countForJob("dan", "job-a")).toBe(0);
  });

  it("a locked report refuses photo edits with the app's own error", () => {
    const db = openMemory();
    const repo = new PhotoRepo(db);
    repo.insert(photo());
    db.run("UPDATE drafts SET local_state = 'submitted' WHERE owner_user_id = ?", ["dan"]);
    expect(() => repo.setCaption("dan", "photo-0001", "x")).toThrow(PhotoLockedError);
  });
});
