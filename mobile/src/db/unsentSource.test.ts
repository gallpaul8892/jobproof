import { openTestDb } from "../../test/support/nodeSqliteDb";
import { PhotoRepo, type NewPhoto } from "./photoRepo";
import { SqliteUnsentItemsSource } from "./unsentSource";

const photo = (id: string, over: Partial<NewPhoto> = {}): NewPhoto => ({
  id,
  ownerUserId: "dan",
  jobId: "job-a",
  stage: "before",
  source: "camera",
  takenAt: "2026-11-09T08:14:00.000Z",
  takenAtSource: "device_clock",
  originalPath: `photos/dan/${id}.jpg`,
  width: 1,
  height: 1,
  bytes: 1,
  createdAt: "2026-11-09T08:14:00.000Z",
  ...over,
});

describe("SqliteUnsentItemsSource: the real count behind the sign-out dialog", () => {
  it("is zero on an empty phone", () => {
    expect(new SqliteUnsentItemsSource(openTestDb()).summaryFor("dan")).toEqual({ photos: 0, reports: 0 });
  });

  it("counts photos that have not been sent, but not sent ones or deleted ones", () => {
    const db = openTestDb();
    const repo = new PhotoRepo(db);
    for (const id of ["photo-0001", "photo-0002", "photo-0003", "photo-0004"]) repo.insert(photo(id));
    db.run("UPDATE photos SET sync_state = 'sent' WHERE id = 'photo-0001'");
    db.run("UPDATE photos SET sync_state = 'failed' WHERE id = 'photo-0002'"); // still not at the office
    db.run("UPDATE photos SET deleted = 1 WHERE id = 'photo-0004'");
    expect(new SqliteUnsentItemsSource(db).summaryFor("dan")).toEqual({ photos: 2, reports: 0 });
  });

  it("counts a job once for a changed draft, a changed checklist or a queued submit", () => {
    const db = openTestDb();
    db.run("INSERT INTO drafts (owner_user_id, job_id, notes_rev) VALUES ('dan', 'job-a', 2)");
    db.run("INSERT INTO checklist_states (owner_user_id, job_id, item_id, rev, synced_rev) VALUES ('dan', 'job-a', 'i1', 3, 1)");
    db.run("INSERT INTO drafts (owner_user_id, job_id, local_state) VALUES ('dan', 'job-b', 'submit_queued')");
    db.run("INSERT INTO drafts (owner_user_id, job_id, notes_rev, notes_synced_rev) VALUES ('dan', 'job-c', 4, 4)"); // in step: not counted
    expect(new SqliteUnsentItemsSource(db).summaryFor("dan")).toEqual({ photos: 0, reports: 2 });
  });

  it("a draft that only exists because a photo was taken is not a changed report", () => {
    const db = openTestDb();
    new PhotoRepo(db).insert(photo("photo-0001"));
    expect(new SqliteUnsentItemsSource(db).summaryFor("dan")).toEqual({ photos: 1, reports: 0 });
  });

  it("counts only the asked user's items", () => {
    const db = openTestDb();
    const repo = new PhotoRepo(db);
    repo.insert(photo("photo-0001"));
    repo.insert(photo("photo-0002", { ownerUserId: "priya", originalPath: "photos/priya/photo-0002.jpg" }));
    const source = new SqliteUnsentItemsSource(db);
    expect(source.summaryFor("dan")).toEqual({ photos: 1, reports: 0 });
    expect(source.summaryFor("priya")).toEqual({ photos: 1, reports: 0 });
    expect(source.summaryFor("nobody")).toEqual({ photos: 0, reports: 0 });
  });
});
