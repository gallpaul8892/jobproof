import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DraftRepo, MAX_ITEMS_PER_REQUEST, ReportLockedError } from "./draftRepo";
import { PhotoRepo } from "./photoRepo";
import { SqliteUnsentItemsSource } from "./unsentSource";
import { openTestDb } from "../../test/support/nodeSqliteDb";

const OPEN = { status: "open", note: null } as const;
const J = "job-a";

describe("DraftRepo: ticks and notes with dirty flags (design 3.4)", () => {
  it("scenario 1: a tick stores the value and bumps rev; unticking bumps it again", () => {
    const repo = new DraftRepo(openTestDb());
    repo.setItem("dan", J, "i1", { status: "done" }, OPEN);
    expect(repo.checklist("dan", J)).toEqual([{ owner_user_id: "dan", job_id: J, item_id: "i1", status: "done", note: null, rev: 1, synced_rev: 0 }]);
    repo.setItem("dan", J, "i1", { status: "open" }, OPEN);
    expect(repo.checklist("dan", J)[0]).toMatchObject({ status: "open", rev: 2 });
  });

  it("starts from what the server shows, so a note added to a ticked item keeps the tick", () => {
    const repo = new DraftRepo(openTestDb());
    repo.setItem("dan", J, "i1", { note: "Second coat tomorrow" }, { status: "done", note: null });
    expect(repo.checklist("dan", J)[0]).toMatchObject({ status: "done", note: "Second coat tomorrow", rev: 1 });
  });

  it("does nothing, and does not tell listeners, when the value is already what is shown", () => {
    let changes = 0;
    const repo = new DraftRepo(openTestDb(), () => void (changes += 1));
    repo.setItem("dan", J, "i1", { status: "open" }, OPEN);
    repo.setNotes("dan", J, null, null);
    expect(repo.checklist("dan", J)).toEqual([]);
    expect(changes).toBe(0);
    expect(repo.dirtyJobIds("dan")).toEqual([]);
  });

  it("stores the job note with its own rev, and a blank (null) note can clear a server note", () => {
    const repo = new DraftRepo(openTestDb());
    repo.setNotes("dan", J, "All rooms done.", null);
    expect(repo.draft("dan", J)).toMatchObject({ notes: "All rooms done.", notes_rev: 1, notes_synced_rev: 0 });
    repo.setNotes("dan", J, null, "server text");
    expect(repo.draft("dan", J)).toMatchObject({ notes: null, notes_rev: 2 });
  });

  it("readDirty returns every changed value with the rev it was read at, and nothing when clean", () => {
    const repo = new DraftRepo(openTestDb());
    expect(repo.readDirty("dan", J)).toBeUndefined();
    repo.setItem("dan", J, "i2", { status: "not_done", note: "Customer took the tin" }, OPEN);
    repo.setItem("dan", J, "i1", { status: "done" }, OPEN);
    repo.setNotes("dan", J, "Notes", null);
    expect(repo.readDirty("dan", J)).toEqual({
      jobId: J,
      notes: { value: "Notes", rev: 1 },
      items: [
        { itemId: "i1", status: "done", note: null, rev: 1 },
        { itemId: "i2", status: "not_done", note: "Customer took the tin", rev: 1 },
      ],
    });
  });

  it("markSynced records the rev that went out: an edit made meanwhile stays dirty", () => {
    const repo = new DraftRepo(openTestDb());
    repo.setItem("dan", J, "i1", { status: "done" }, OPEN);
    repo.setNotes("dan", J, "v1", null);
    const sent = repo.readDirty("dan", J)!;
    repo.setItem("dan", J, "i1", { note: "added while sending" }, OPEN); // in-flight edit
    repo.markSynced("dan", sent);
    expect(repo.checklist("dan", J)[0]).toMatchObject({ rev: 2, synced_rev: 1 });
    expect(repo.draft("dan", J)).toMatchObject({ notes_rev: 1, notes_synced_rev: 1 });
    expect(repo.dirtyJobIds("dan")).toEqual([J]);
    expect(repo.readDirty("dan", J)).toEqual({ jobId: J, items: [{ itemId: "i1", status: "done", note: "added while sending", rev: 2 }] });
  });

  it("after a send the server's value is shown again: a new edit starts from the server's base", () => {
    const repo = new DraftRepo(openTestDb());
    repo.setItem("dan", J, "i1", { status: "done" }, OPEN);
    repo.markSynced("dan", repo.readDirty("dan", J)!);
    // The server (another device) now says not_done; the operative adds a note: status comes from the server's value.
    repo.setItem("dan", J, "i1", { note: "n" }, { status: "not_done", note: null });
    expect(repo.checklist("dan", J)[0]).toMatchObject({ status: "not_done", note: "n", rev: 2, synced_rev: 1 });
  });

  it("limits one request to 200 items; the rest are read on the next round", () => {
    const repo = new DraftRepo(openTestDb());
    for (let i = 0; i < MAX_ITEMS_PER_REQUEST + 5; i++) repo.setItem("dan", J, `i${String(i).padStart(3, "0")}`, { status: "done" }, OPEN);
    const first = repo.readDirty("dan", J)!;
    expect(first.items).toHaveLength(MAX_ITEMS_PER_REQUEST);
    repo.markSynced("dan", first);
    expect(repo.readDirty("dan", J)!.items).toHaveLength(5);
  });

  it("is per user: a second operative on the phone neither sees nor sends the first one's work", () => {
    const repo = new DraftRepo(openTestDb());
    repo.setItem("dan", J, "i1", { status: "done" }, OPEN);
    repo.setNotes("dan", J, "Dan's note", null);
    expect(repo.dirtyJobIds("priya")).toEqual([]);
    expect(repo.readDirty("priya", J)).toBeUndefined();
    expect(repo.checklist("priya", J)).toEqual([]);
    expect(repo.draft("priya", J)).toBeUndefined();
    repo.setItem("priya", J, "i1", { status: "not_done" }, OPEN); // the same job id and item id, kept apart
    expect(repo.checklist("dan", J)[0]).toMatchObject({ status: "done" });
    expect(repo.dirtyJobIds("dan")).toEqual([J]);
  });

  it("refuses edits once the report is submitted or queued, and leaves nothing half written", () => {
    const db = openTestDb();
    const repo = new DraftRepo(db);
    repo.setNotes("dan", J, "n", null);
    db.run("UPDATE drafts SET local_state = 'submit_queued' WHERE owner_user_id = 'dan' AND job_id = ?", [J]);
    expect(repo.isEditable("dan", J)).toBe(false);
    expect(() => repo.setItem("dan", J, "i1", { status: "done" }, OPEN)).toThrow(ReportLockedError);
    expect(() => repo.setNotes("dan", J, "x", null)).toThrow(ReportLockedError);
    expect(repo.checklist("dan", J)).toEqual([]);
    expect(repo.readDirty("dan", J)).toBeUndefined(); // a queued submit carries its own draft (T-003h)
    expect(repo.dirtyJobIds("dan")).toEqual([]);
  });

  it("keeps stuck jobs out of automatic sends, lists them as needing attention, and clearErrors gives them another try", () => {
    const repo = new DraftRepo(openTestDb());
    repo.setNotes("dan", J, "n", null);
    repo.setNotes("dan", "job-b", "m", null);
    repo.setError("dan", J, "job_cancelled");
    expect(repo.dirtyJobIds("dan")).toEqual(["job-b"]);
    expect(repo.dirtyJobIds("dan", true)).toEqual([J, "job-b"]);
    expect(repo.attentionJobIds("dan")).toEqual([{ jobId: J, code: "job_cancelled" }]);
    repo.clearErrors("dan");
    expect(repo.attentionJobIds("dan")).toEqual([]);
    expect(repo.dirtyJobIds("dan")).toEqual([J, "job-b"]);
  });

  it("a successful send clears the job's error", () => {
    const repo = new DraftRepo(openTestDb());
    repo.setNotes("dan", J, "n", null);
    repo.setError("dan", J, "x");
    repo.markSynced("dan", repo.readDirty("dan", J)!);
    expect(repo.draft("dan", J)!.last_error_code).toBeNull();
  });

  it("tells listeners after a write", () => {
    let changes = 0;
    const repo = new DraftRepo(openTestDb(), () => void (changes += 1));
    repo.setItem("dan", J, "i1", { status: "done" }, OPEN);
    repo.setNotes("dan", J, "n", null);
    expect(changes).toBe(2);
  });
});

describe("scenario 8: the draft survives the app being killed (new connection to the same file)", () => {
  let dir: string;
  beforeEach(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobproof-draft-"))));
  afterEach(() => {
    const file = path.join(dir, "jobproof.db");
    for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
    fs.rmdirSync(dir);
  });

  it("keeps 4 ticks and the note, still dirty and counted as unsent", () => {
    const file = path.join(dir, "jobproof.db");
    const first = openTestDb(file);
    const repo = new DraftRepo(first);
    for (const id of ["i1", "i2", "i3", "i4"]) repo.setItem("dan", J, id, { status: "done" }, OPEN);
    repo.setNotes("dan", J, "Needs second coat on window wall", null);
    first.close(); // killed: nothing was closed gracefully by the app, the file is all that is left

    const second = openTestDb(file);
    const reopened = new DraftRepo(second);
    expect(reopened.checklist("dan", J).filter((r) => r.status === "done")).toHaveLength(4);
    expect(reopened.draft("dan", J)?.notes).toBe("Needs second coat on window wall");
    expect(reopened.dirtyJobIds("dan")).toEqual([J]);
    expect(new SqliteUnsentItemsSource(second).summaryFor("dan")).toEqual({ photos: 0, reports: 1 });
    second.close();
  });
});

describe("moving a photo to another item (scenario 6)", () => {
  const photo = (id: string, itemId: string | null) => ({
    id,
    ownerUserId: "dan",
    jobId: J,
    stage: "during" as const,
    checklistItemId: itemId,
    source: "camera" as const,
    takenAt: "2026-11-09T08:14:00.000Z",
    takenAtSource: "device_clock" as const,
    originalPath: `photos/dan/${id}.jpg`,
    width: 1,
    height: 1,
    bytes: 1,
    createdAt: "2026-11-09T08:14:00.000Z",
  });

  it("changes checklist_item_id in place, bumps meta_rev, and adds no row", () => {
    const repo = new PhotoRepo(openTestDb());
    repo.insert(photo("photo-0001", "item-3"));
    const before = repo.get("dan", "photo-0001")!;
    repo.setItem("dan", "photo-0001", "item-5");
    const after = repo.get("dan", "photo-0001")!;
    expect(after.checklist_item_id).toBe("item-5");
    expect(after.meta_rev).toBe(before.meta_rev + 1);
    expect(after.meta_synced_rev).toBe(before.meta_synced_rev);
    expect(repo.countForJob("dan", J)).toBe(1);
    expect(repo.countForItem("dan", J, "item-3")).toBe(0);
    expect(repo.countForItem("dan", J, "item-5")).toBe(1);
    expect(after.sync_state).toBe(before.sync_state); // no re-upload
  });

  it("can detach a photo from its item, and a move to the same item changes nothing", () => {
    const repo = new PhotoRepo(openTestDb());
    repo.insert(photo("photo-0001", "item-3"));
    repo.setItem("dan", "photo-0001", "item-3");
    expect(repo.get("dan", "photo-0001")!.meta_rev).toBe(1);
    repo.setItem("dan", "photo-0001", null);
    expect(repo.get("dan", "photo-0001")).toMatchObject({ checklist_item_id: null, meta_rev: 2 });
  });

  it("refuses a 13th photo on an item and a move after submission", () => {
    const db = openTestDb();
    const repo = new PhotoRepo(db);
    for (let i = 0; i < 12; i++) repo.insert(photo(`photo-${String(i).padStart(4, "0")}`, "item-5"));
    repo.insert(photo("photo-9999", "item-3"));
    expect(() => repo.setItem("dan", "photo-9999", "item-5")).toThrow("maximum 12");
    db.run("UPDATE drafts SET local_state = 'submitted'");
    expect(() => repo.setItem("dan", "photo-9999", "item-4")).toThrow("submitted");
  });

  it("only moves the owner's own photo", () => {
    const repo = new PhotoRepo(openTestDb());
    repo.insert(photo("photo-0001", "item-3"));
    repo.setItem("priya", "photo-0001", "item-5");
    expect(repo.get("dan", "photo-0001")!.checklist_item_id).toBe("item-3");
  });
});
