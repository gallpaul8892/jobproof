import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeTestStore } from "../../test/support/store";
import { MemoryPhotoFiles } from "../../test/support/memoryFiles";
import { openTestDb } from "../../test/support/nodeSqliteDb";
import { cleanUpPhotoStorage } from "./orphans";
import { originalPath, parseOriginalName, extensionFor, thumbPath, uploadPath, userDir } from "./paths";

const ID = "11111111-aaaa-4bbb-8ccc-222222222222";
const run = (t: ReturnType<typeof makeTestStore>, user = "dan") => cleanUpPhotoStorage({ repo: t.store.photos, files: t.files, ownerUserId: user, now: () => new Date("2026-11-09T09:00:00Z") });

describe("crash safety: the app is killed between the file move and the row insert (scenario 4)", () => {
  it("recovery turns the orphan file into a row on the job the camera was open for, at the last stage, flagged recovered", async () => {
    const t = makeTestStore();
    t.store.photos.setCaptureIntent("dan", "job-a");
    t.store.photos.setLastStage("dan", "during");
    // The "kill": the move succeeded, then the process died before the INSERT ran.
    t.files.seed(`file:///app/${originalPath("dan", ID)}`, "third-photo", 1_700_000_000_000);
    expect(t.store.photos.countForJob("dan", "job-a")).toBe(0);

    const report = run(t);

    expect(report).toMatchObject({ recovered: 1, unattached: 0 });
    const [row] = t.store.photos.listForJob("dan", "job-a");
    expect(row).toMatchObject({ id: ID, stage: "during", recovered: 1, source: "camera", taken_at_source: "added_time", original_bytes: 11 });
    expect(row!.taken_at).toBe(new Date(1_700_000_000_000).toISOString());
    expect(t.files.exists(row!.original_path)).toBe(true);
    expect(t.store.photos.reportState("dan", "job-a")).toBe("draft");
  });

  it("is simulated for real: saveShot dies after the move (insert throws); a restarted app recovers the photo", async () => {
    const t = makeTestStore();
    t.store.photos.setCaptureIntent("dan", "job-a");
    const realInsert = t.store.photos.insert.bind(t.store.photos);
    t.store.photos.insert = () => {
      throw new Error("process killed");
    };
    const r = await t.store.capture.saveShot({ ownerUserId: "dan", jobId: "job-a", stage: "after" }, { uri: t.files.seed("file:///cache/x.jpg", "x"), width: 1, height: 1 });
    expect(r.ok).toBe(false);
    t.store.photos.insert = realInsert;
    expect(t.files.list(userDir("dan"))).toHaveLength(1); // the file was NOT deleted on failure

    expect(run(t).recovered).toBe(1);
    expect(t.store.photos.countForJob("dan", "job-a")).toBe(1);
  });

  it("running recovery twice does not duplicate", () => {
    const t = makeTestStore();
    t.store.photos.setCaptureIntent("dan", "job-a");
    t.files.seed(`file:///app/${originalPath("dan", ID)}`);
    run(t);
    expect(run(t)).toMatchObject({ recovered: 0 });
    expect(t.store.photos.countForJob("dan", "job-a")).toBe(1);
  });

  it("with no known job the file is kept, never deleted", () => {
    const t = makeTestStore();
    t.files.seed(`file:///app/${originalPath("dan", ID)}`);
    expect(run(t)).toMatchObject({ recovered: 0, unattached: 1 });
    expect(t.files.exists(originalPath("dan", ID))).toBe(true);
  });

  it("an empty file is not turned into a photo and is not deleted", () => {
    const t = makeTestStore();
    t.store.photos.setCaptureIntent("dan", "job-a");
    t.files.entries.set(`file:///app/${originalPath("dan", ID)}`, { bytes: new Uint8Array(0), mtime: 0 });
    expect(run(t)).toMatchObject({ recovered: 0, unattached: 1 });
  });

  it("a photo the operative deleted (flag set, files kept for the engine) is not resurrected", async () => {
    const t = makeTestStore();
    const r = await t.store.capture.saveShot({ ownerUserId: "dan", jobId: "job-a", stage: "before" }, { uri: t.files.seed("file:///cache/a.jpg"), width: 1, height: 1 });
    if (!r.ok) throw new Error();
    t.db.run("UPDATE photos SET sync_state = 'sent' WHERE id = ?", [r.photo.id]);
    await t.store.capture.deletePhoto("dan", r.photo.id);
    t.store.photos.setCaptureIntent("dan", "job-a");
    expect(run(t).recovered).toBe(0);
    expect(t.store.photos.countForJob("dan", "job-a")).toBe(0);
  });

  it("only recovers the signed-in user's own folder", () => {
    const t = makeTestStore();
    t.store.photos.setCaptureIntent("dan", "job-a");
    t.files.seed(`file:///app/${originalPath("priya", ID)}`);
    expect(run(t, "dan")).toMatchObject({ recovered: 0, unattached: 0 });
  });
});

describe("orphan cleanup of derived and half-written files", () => {
  it("deletes half-copied .part files (the gallery still has the source) but keeps real photos", async () => {
    const t = makeTestStore();
    t.files.seed(`file:///app/${originalPath("dan", ID)}.part`, "half");
    const report = run(t);
    expect(report.partialsRemoved).toBe(1);
    expect(t.files.list(userDir("dan"))).toEqual([]);
  });

  it("removes previews that belong to no photo and keeps those that do", async () => {
    const t = makeTestStore();
    const r = await t.store.capture.saveShot({ ownerUserId: "dan", jobId: "job-a", stage: "before" }, { uri: t.files.seed("file:///cache/a.jpg"), width: 1, height: 1 });
    if (!r.ok) throw new Error();
    await t.store.capture.idle();
    t.files.seed(`file:///app/${thumbPath("dan", ID)}`);
    const report = run(t);
    expect(report.thumbsRemoved).toBe(1);
    expect(t.files.exists(thumbPath("dan", r.photo.id))).toBe(true);
    expect(t.files.exists(thumbPath("dan", ID))).toBe(false);
  });

  it("finishes a delete that was interrupted after the flag was committed", async () => {
    const t = makeTestStore();
    const r = await t.store.capture.saveShot({ ownerUserId: "dan", jobId: "job-a", stage: "before" }, { uri: t.files.seed("file:///cache/a.jpg"), width: 1, height: 1 });
    if (!r.ok) throw new Error();
    await t.store.capture.idle();
    t.store.photos.markDeleted("dan", r.photo.id); // killed here: files and row still there
    expect(t.files.exists(r.photo.original_path)).toBe(true);
    expect(run(t).deletesFinished).toBe(1);
    expect(t.files.list(userDir("dan"))).toEqual([]);
    expect(t.store.photos.get("dan", r.photo.id)).toBeUndefined();
  });

  it("leaves files it does not recognise alone", () => {
    const t = makeTestStore();
    t.files.seed(`file:///app/${userDir("dan")}/notes.txt`);
    run(t);
    expect(t.files.list(userDir("dan"))).toEqual(["notes.txt"]);
  });
});

describe("a committed row survives the process dying (real SQLite file, WAL, synchronous=FULL)", () => {
  let dir: string;
  beforeEach(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobproof-crash-"))));
  afterEach(() => {
    const file = path.join(dir, "jobproof.db");
    for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
    fs.rmdirSync(dir);
  });

  it("three photos taken, the process is killed (the first connection is never closed), a new one sees all three intact", async () => {
    const file = path.join(dir, "jobproof.db");
    const files = new MemoryPhotoFiles();
    const first = makeTestStore({ db: openTestDbAt(file), files });
    for (let i = 0; i < 3; i++) {
      const r = await first.store.capture.saveShot({ ownerUserId: "dan", jobId: "job-a", stage: "before" }, { uri: files.seed(`file:///cache/${i}.jpg`, `photo-${i}`), width: 4000, height: 3000 });
      expect(r.ok).toBe(true);
    }
    // No close(), no checkpoint: that is what a kill looks like. A fresh connection to the same file:
    const second = makeTestStore({ db: openTestDbAt(file), files });
    const rows = second.store.photos.listForJob("dan", "job-a");
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(files.exists(r.original_path)).toBe(true);
      expect(files.size(r.original_path)).toBeGreaterThan(0); // not corrupt or empty
    }
    expect(run(second).recovered).toBe(0); // nothing was lost, so nothing to recover
    first.db.close();
    second.db.close();
  });
});

function openTestDbAt(file: string) {
  return openTestDb(file);
}

describe("paths", () => {
  it("builds the design's layout, relative to the document directory", () => {
    expect(originalPath("dan", ID)).toBe(`photos/dan/${ID}.jpg`);
    expect(thumbPath("dan", ID)).toBe(`photos/dan/thumbs/${ID}.jpg`);
    expect(uploadPath("dan", ID)).toBe(`photos/dan/upload/${ID}.jpg`);
  });
  it("refuses ids that could climb out of the folder", () => {
    expect(() => originalPath("../x", ID)).toThrow();
    expect(() => originalPath("dan", "a/b")).toThrow();
    expect(() => userDir("")).toThrow();
  });
  it("parses original names", () => {
    expect(parseOriginalName(`${ID}.jpg`)).toEqual({ id: ID, ext: "jpg" });
    expect(parseOriginalName(`${ID}.jpg.part`)).toBeNull();
    expect(parseOriginalName("thumbs")).toBeNull();
  });
  it("picks the extension from the type, then the file name, else jpg", () => {
    expect(extensionFor("image/png", "x")).toBe("png");
    expect(extensionFor(undefined, "file:///a/b.HEIC?x=1")).toBe("heic");
    expect(extensionFor(undefined, "file:///a/b")).toBe("jpg");
    expect(extensionFor("application/pdf", "file:///a/b.exe")).toBe("jpg");
  });
});
