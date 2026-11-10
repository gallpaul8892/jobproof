import { openTestDb } from "../../test/support/nodeSqliteDb";
import { PhotoLockedError, PhotoRepo, type NewPhoto } from "./photoRepo";

const base = (over: Partial<NewPhoto> = {}): NewPhoto => ({
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

function setup() {
  const db = openTestDb();
  const changes: number[] = [];
  const repo = new PhotoRepo(db, () => changes.push(1));
  return { db, repo, changes };
}

describe("PhotoRepo", () => {
  it("inserting a photo creates the job's draft in the same step (A4) and notifies", () => {
    const { repo, changes } = setup();
    expect(repo.reportState("dan", "job-a")).toBeUndefined();
    repo.insert(base());
    expect(repo.reportState("dan", "job-a")).toBe("draft");
    expect(changes).toHaveLength(1);
  });

  it("a failed insert leaves neither the photo nor the draft", () => {
    const { repo } = setup();
    expect(() => repo.insert(base({ stage: "nope" as never }))).toThrow();
    expect(repo.reportState("dan", "job-a")).toBeUndefined();
  });

  it("every query is filtered by owner: a second operative sees nothing of the first", () => {
    const { repo } = setup();
    repo.insert(base());
    expect(repo.listForJob("priya", "job-a")).toEqual([]);
    expect(repo.get("priya", "photo-0001")).toBeUndefined();
    expect(repo.countForJob("priya", "job-a")).toBe(0);
    expect(repo.reportState("priya", "job-a")).toBeUndefined();
  });

  it("photos belong to their job only (scenario 14)", () => {
    const { repo } = setup();
    repo.insert(base({ id: "photo-000a", jobId: "job-a" }));
    repo.insert(base({ id: "photo-000b", jobId: "job-b" }));
    expect(repo.listForJob("dan", "job-a").map((p) => p.id)).toEqual(["photo-000a"]);
    expect(repo.listForJob("dan", "job-b").map((p) => p.id)).toEqual(["photo-000b"]);
  });

  it("counts skip deleted photos, per job and per item", () => {
    const { repo } = setup();
    repo.insert(base({ id: "photo-000a", checklistItemId: "item-1" }));
    repo.insert(base({ id: "photo-000b", checklistItemId: "item-1" }));
    repo.insert(base({ id: "photo-000c" }));
    expect(repo.countForJob("dan", "job-a")).toBe(3);
    expect(repo.countForItem("dan", "job-a", "item-1")).toBe(2);
    repo.markDeleted("dan", "photo-000a");
    expect(repo.countForJob("dan", "job-a")).toBe(2);
    expect(repo.countForItem("dan", "job-a", "item-1")).toBe(1);
  });

  it("changing stage or caption bumps meta_rev (the dirty flag) and keeps meta_synced_rev", () => {
    const { repo } = setup();
    repo.insert(base());
    const before = repo.get("dan", "photo-0001")!;
    repo.setStage("dan", "photo-0001", "after");
    repo.setCaption("dan", "photo-0001", "Damp patch above window");
    const after = repo.get("dan", "photo-0001")!;
    expect(after.stage).toBe("after");
    expect(after.caption).toBe("Damp patch above window");
    expect(after.meta_rev).toBe(before.meta_rev + 2);
    expect(after.meta_synced_rev).toBe(before.meta_synced_rev);
  });

  it.each(["submitted", "submit_queued"])("edits and deletes are refused once the report is %s", (state) => {
    const { repo, db } = setup();
    repo.insert(base());
    db.run("UPDATE drafts SET local_state = ? WHERE owner_user_id = 'dan'", [state]);
    expect(() => repo.setStage("dan", "photo-0001", "after")).toThrow(PhotoLockedError);
    expect(() => repo.setCaption("dan", "photo-0001", "x")).toThrow(PhotoLockedError);
    expect(() => repo.markDeleted("dan", "photo-0001")).toThrow(PhotoLockedError);
    expect(repo.isEditable("dan", "job-a")).toBe(false);
  });

  it("a rejected report is editable again", () => {
    const { repo, db } = setup();
    repo.insert(base());
    db.run("UPDATE drafts SET local_state = 'rejected'");
    expect(repo.isEditable("dan", "job-a")).toBe(true);
  });

  it("remembers the last used stage per user and falls back to Before", () => {
    const { repo } = setup();
    expect(repo.lastStage("dan")).toBe("before");
    repo.setLastStage("dan", "after");
    expect(repo.lastStage("dan")).toBe("after");
    expect(repo.lastStage("priya")).toBe("before");
  });
});
