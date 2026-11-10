import type { LocalDb } from "../db/localDb";
import type { PhotoRow } from "../db/photoRepo";
import { makeTestStore } from "../../test/support/store";
import { UPLOAD_JPEG_QUALITY, UPLOAD_MAX_EDGE, fitLongEdge } from "./imageTools";
import { ensureUploadCopy } from "./uploadCopy";

async function oneSavedPhoto() {
  const t = makeTestStore();
  const r = await t.store.capture.saveShot({ ownerUserId: "dan", jobId: "job-a", stage: "before" }, { uri: t.files.seed("file:///cache/a.jpg", "original-bytes"), width: 4000, height: 3000 });
  if (!r.ok) throw new Error("save failed");
  await t.store.capture.idle();
  t.tools.calls.length = 0;
  return { ...t, photo: t.store.photos.get("dan", r.photo.id)! };
}

describe("upload copy limits (design 3.6 step 8)", () => {
  it("uses long edge 2560 and JPEG quality 0.8", () => {
    expect(UPLOAD_MAX_EDGE).toBe(2560);
    expect(UPLOAD_JPEG_QUALITY).toBe(0.8);
  });

  it.each([
    [4000, 3000, 2560, 1920],
    [3000, 4000, 1920, 2560],
    [2560, 1000, 2560, 1000],
    [800, 600, 800, 600],
    [10000, 1, 2560, 1],
  ])("fitLongEdge %ix%i -> %ix%i", (w, h, ew, eh) => {
    expect(fitLongEdge(w, h, 2560)).toEqual({ width: ew, height: eh });
  });
});

describe("ensureUploadCopy", () => {
  it("makes the copy from the original at the limits, stores path, size and SHA-256, and leaves the original alone", async () => {
    const { db, files, tools, photo } = await oneSavedPhoto();
    const copy = await ensureUploadCopy({ db, files, tools }, photo);
    expect(tools.calls).toEqual([{ sourceUri: files.uri(photo.original_path), maxEdge: 2560, quality: 0.8 }]);
    expect(copy.path).toBe(`photos/dan/upload/${photo.id}.jpg`);
    expect(copy.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(copy.bytes).toBeGreaterThan(0);
    expect(files.exists(photo.original_path)).toBe(true);
    const row = db.get<{ upload_path: string; upload_sha256: string; upload_width: number }>("SELECT * FROM photos WHERE id = ?", [photo.id])!;
    expect(row).toMatchObject({ upload_path: copy.path, upload_sha256: copy.sha256, upload_width: 2560 });
  });

  it("is made ONCE: a second call reuses the stored copy (same bytes, no second encode)", async () => {
    const { db, files, tools, photo } = await oneSavedPhoto();
    const first = await ensureUploadCopy({ db, files, tools }, photo);
    const second = await ensureUploadCopy({ db, files, tools }, store(photo, db));
    expect(second).toEqual(first);
    expect(tools.calls).toHaveLength(1);
  });

  it("if the resize fails nothing is stored and the original is untouched", async () => {
    const { db, files, tools, photo } = await oneSavedPhoto();
    tools.fail = true;
    await expect(ensureUploadCopy({ db, files, tools }, photo)).rejects.toThrow();
    expect(db.get<{ upload_path: string | null }>("SELECT upload_path FROM photos WHERE id = ?", [photo.id])!.upload_path).toBeNull();
    expect(files.exists(photo.original_path)).toBe(true);
  });

  it("refuses when the original file is missing", async () => {
    const { db, files, tools, photo } = await oneSavedPhoto();
    files.remove(photo.original_path);
    await expect(ensureUploadCopy({ db, files, tools }, photo)).rejects.toThrow(/missing/);
  });
});

function store(photo: PhotoRow, db: LocalDb): PhotoRow {
  return db.get<PhotoRow>("SELECT * FROM photos WHERE id = ?", [photo.id])!;
}
