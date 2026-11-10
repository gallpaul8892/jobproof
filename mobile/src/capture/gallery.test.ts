import { makeTestStore } from "../../test/support/store";
import type { CaptureTarget } from "./captureService";
import type { PickedAsset } from "./gallery";

const T: CaptureTarget = { ownerUserId: "dan", jobId: "job-a", stage: "during" };
const asset = (files: { seed(uri: string, c?: string): string }, name: string, over: Partial<PickedAsset> = {}): PickedAsset => ({
  uri: files.seed(`file:///picker/${name}.jpg`, name),
  width: 3000,
  height: 4000,
  type: "image",
  mimeType: "image/jpeg",
  exif: { DateTimeOriginal: "2026:11:08 17:05:09" },
  ...over,
});

describe("gallery import (scenarios 5, 6, 12)", () => {
  it("copies the photo (the gallery original stays), marks it From gallery and keeps the time it was taken", async () => {
    const { store, files } = makeTestStore();
    const a = asset(files, "one");
    const summary = await store.capture.importAssets(T, [a]);
    expect(summary).toMatchObject({ added: 1, skipped: 0, message: "1 photo added." });
    const [row] = store.photos.listForJob("dan", "job-a");
    expect(row).toMatchObject({ source: "gallery", stage: "during", taken_at: "2026-11-08T17:05:09.000Z", taken_at_source: "file_metadata" });
    expect(files.entries.has(a.uri)).toBe(true); // copied, not moved
    expect(files.exists(row!.original_path)).toBe(true);
  });

  it("with no EXIF date the time added is used and recorded as such", async () => {
    const { store, files } = makeTestStore();
    await store.capture.importAssets(T, [asset(files, "plain", { exif: null })]);
    expect(store.photos.listForJob("dan", "job-a")[0]).toMatchObject({ taken_at: "2026-11-09T08:14:00.000Z", taken_at_source: "added_time" });
  });

  it("four picked photos all go in at one stage with the summary '4 photos added'", async () => {
    const { store, files } = makeTestStore();
    const summary = await store.capture.importAssets(T, ["a", "b", "c", "d"].map((n) => asset(files, n)));
    expect(summary.message).toBe("4 photos added.");
    const rows = store.photos.listForJob("dan", "job-a");
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.stage))).toEqual(new Set(["during"]));
  });

  it("skips a video, a deleted file and an empty file, adds the rest, and says so", async () => {
    const { store, files } = makeTestStore();
    const good = asset(files, "good");
    const video = asset(files, "clip", { type: "video", mimeType: "video/mp4" });
    const gone: PickedAsset = { uri: "file:///picker/deleted.jpg", type: "image", mimeType: "image/jpeg" }; // never seeded
    const empty = asset(files, "empty");
    files.entries.set(empty.uri, { bytes: new Uint8Array(0), mtime: 0 });
    const summary = await store.capture.importAssets(T, [video, good, gone, empty]);
    expect(summary).toMatchObject({ added: 1, skipped: 3 });
    expect(summary.message).toBe("1 photo added. 3 files couldn't be added.");
    expect(store.photos.countForJob("dan", "job-a")).toBe(1);
    expect([...files.entries.keys()].filter((k) => k.endsWith(".part"))).toEqual([]); // nothing half-copied is left
  });

  it("one unreadable file is reported as '1 file couldn't be added'", async () => {
    const { store, files } = makeTestStore();
    const s = await store.capture.importAssets(T, [asset(files, "a"), { uri: "file:///picker/missing.jpg", type: "image" }]);
    expect(s.message).toBe("1 photo added. 1 file couldn't be added.");
    const only = await store.capture.importAssets(T, [{ uri: "file:///picker/missing2.jpg", type: "image" }]);
    expect(only.message).toBe("1 file couldn't be added.");
  });

  it("a copy that fails part-way leaves no .part file and no row", async () => {
    const { store, files } = makeTestStore();
    files.failNext = "rename";
    const s = await store.capture.importAssets(T, [asset(files, "a")]);
    expect(s).toMatchObject({ added: 0, skipped: 1 });
    expect([...files.entries.keys()].filter((k) => k.includes("/photos/"))).toEqual([]);
  });

  it("keeps HEIC and PNG originals under their own extension (converted later for upload)", async () => {
    const { store, files } = makeTestStore();
    await store.capture.importAssets(T, [asset(files, "h", { mimeType: "image/heic" }), asset(files, "p", { mimeType: "image/png" })]);
    const exts = store.photos.listForJob("dan", "job-a").map((r) => r.original_path.split(".").pop()).sort();
    expect(exts).toEqual(["heic", "png"]);
  });

  it("stops at the report limit: adds what fits and says why", async () => {
    const { store, files } = makeTestStore();
    for (let i = 0; i < 58; i++) await store.capture.saveShot(T, { uri: files.seed(`file:///cache/c${i}.jpg`), width: 1, height: 1 });
    const s = await store.capture.importAssets(T, ["a", "b", "c", "d"].map((n) => asset(files, n)));
    expect(s).toMatchObject({ added: 2, limit: "This report has the maximum 60 photos." });
    expect(s.message).toBe("2 photos added. This report has the maximum 60 photos.");
    expect(store.photos.countForJob("dan", "job-a")).toBe(60);
  });

  it("adds nothing when the report is already full, and the picker is told how many it may allow", async () => {
    const { store, files } = makeTestStore();
    expect(store.capture.room(T)).toMatchObject({ ok: true, remaining: 60 });
    for (let i = 0; i < 12; i++) await store.capture.saveShot({ ...T, itemId: "i1" }, { uri: files.seed(`file:///cache/c${i}.jpg`), width: 1, height: 1 });
    expect(store.capture.room({ ...T, itemId: "i1" })).toMatchObject({ ok: false, reason: "item_full" });
    const s = await store.capture.importAssets({ ...T, itemId: "i1" }, [asset(files, "x")]);
    expect(s).toMatchObject({ added: 0, message: "This item has the maximum 12 photos." });
    expect(store.capture.room({ ...T, itemId: "i2" })).toMatchObject({ ok: true, remaining: 12 }); // the item cap
    expect(store.capture.room(T)).toMatchObject({ ok: true, remaining: 48 });
  });
});
