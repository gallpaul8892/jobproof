import { makeTestStore } from "../../test/support/store";
import { MB } from "../../test/support/memoryFiles";
import { CAPTURE_MSG } from "./messages";
import type { CaptureTarget, Shot } from "./captureService";

const DAN: CaptureTarget = { ownerUserId: "dan", jobId: "job-a", stage: "before" };
let n = 0;
const shot = (files: { seed(uri: string, c?: string): string }, name = `s${++n}`): Shot => ({ uri: files.seed(`file:///cache/${name}.jpg`, name), width: 4000, height: 3000 });

describe("saving a camera shot (scenarios 1, 3, 13)", () => {
  it("moves the file into app-private storage and commits the row; the cache copy is gone", async () => {
    const { store, files } = makeTestStore();
    const s = shot(files);
    const r = await store.capture.saveShot(DAN, s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.photo).toMatchObject({ job_id: "job-a", stage: "before", source: "camera", taken_at_source: "device_clock", sync_state: "saved", original_width: 4000, original_height: 3000, deleted: 0 });
    expect(r.photo.taken_at).toBe("2026-11-09T08:14:00.000Z");
    expect(files.exists(r.photo.original_path)).toBe(true);
    expect(r.photo.original_path).toBe(`photos/dan/${r.photo.id}.jpg`);
    expect(files.entries.has(s.uri)).toBe(false); // moved, not copied
    expect(store.photos.reportState("dan", "job-a")).toBe("draft"); // the job is now in progress locally
  });

  it("only ever writes under photos/<user>/ : nothing is written to a shared or gallery location (P6)", async () => {
    const { store, files } = makeTestStore();
    await store.capture.saveShot(DAN, shot(files));
    await store.capture.idle();
    for (const key of files.entries.keys()) expect(key.startsWith("file:///app/photos/dan/") || key.startsWith("file:///cache/")).toBe(true);
  });

  it("5 rapid shots give 5 rows, 5 files and distinct ids (scenario 3)", async () => {
    const { store, files } = makeTestStore();
    const results = await Promise.all(Array.from({ length: 5 }, () => store.capture.saveShot(DAN, shot(files))));
    expect(results.every((r) => r.ok)).toBe(true);
    const rows = store.photos.listForJob("dan", "job-a");
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.id)).size).toBe(5);
    expect(new Set(rows.map((r) => r.original_path)).size).toBe(5);
    for (const r of rows) expect(files.exists(r.original_path)).toBe(true);
  });

  it("remembers the stage used for the next time", async () => {
    const { store, files } = makeTestStore();
    await store.capture.saveShot({ ...DAN, stage: "after" }, shot(files));
    expect(store.photos.lastStage("dan")).toBe("after");
  });

  it("makes a small preview in the background without holding up the save", async () => {
    const { store, files, tools } = makeTestStore();
    const r = await store.capture.saveShot(DAN, shot(files));
    if (!r.ok) throw new Error("save failed");
    expect(store.photos.get("dan", r.photo.id)!.thumb_path).toBeNull(); // not yet: saving did not wait for it
    await store.capture.idle();
    const row = store.photos.get("dan", r.photo.id)!;
    expect(row.thumb_path).toBe(`photos/dan/thumbs/${r.photo.id}.jpg`);
    expect(files.exists(row.thumb_path!)).toBe(true);
    expect(tools.calls[0]).toMatchObject({ maxEdge: 480 });
    expect(files.exists(row.original_path)).toBe(true); // the original is untouched
  });

  it("a failing preview never loses or blocks the photo", async () => {
    const { store, files, tools } = makeTestStore();
    tools.fail = true;
    const r = await store.capture.saveShot(DAN, shot(files));
    await store.capture.idle();
    expect(r.ok).toBe(true);
    expect(store.photos.countForJob("dan", "job-a")).toBe(1);
  });

  it("when the move fails the operative is told and no row exists", async () => {
    const { store, files } = makeTestStore();
    files.failNext = "moveTo";
    const r = await store.capture.saveShot(DAN, shot(files));
    expect(r).toMatchObject({ ok: false, message: CAPTURE_MSG.saveFailed });
    expect(store.photos.countForJob("dan", "job-a")).toBe(0);
  });
});

describe("switching jobs mid-capture (scenario 14)", () => {
  it("a photo whose save is still running lands on the job it was taken for", async () => {
    const { store, files } = makeTestStore();
    const slow = shot(files, "slow");
    const realMove = files.moveTo.bind(files);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    files.moveTo = async (src, dest) => {
      if (src === slow.uri) await gate;
      return realMove(src, dest);
    };
    const forA = store.capture.saveShot({ ...DAN, jobId: "job-a" }, slow);
    const forB = await store.capture.saveShot({ ...DAN, jobId: "job-b" }, shot(files, "fast"));
    release();
    await forA;
    expect(forB.ok && forB.photo.job_id).toBe("job-b");
    expect(store.photos.listForJob("dan", "job-a")).toHaveLength(1);
    expect(store.photos.listForJob("dan", "job-b")).toHaveLength(1);
  });
});

describe("limits (scenario 10)", () => {
  it("refuses the 61st photo on a report with the exact message and adds nothing", async () => {
    const { store, files } = makeTestStore();
    for (let i = 0; i < 60; i++) expect((await store.capture.saveShot(DAN, shot(files))).ok).toBe(true);
    const r = await store.capture.saveShot(DAN, shot(files));
    expect(r).toMatchObject({ ok: false, reason: "report_full", message: "This report has the maximum 60 photos." });
    expect(store.photos.countForJob("dan", "job-a")).toBe(60);
  });

  it("refuses the 13th photo on one item", async () => {
    const { store, files } = makeTestStore();
    const item = { ...DAN, itemId: "item-1" };
    for (let i = 0; i < 12; i++) expect((await store.capture.saveShot(item, shot(files))).ok).toBe(true);
    const r = await store.capture.saveShot(item, shot(files));
    expect(r).toMatchObject({ ok: false, reason: "item_full", message: "This item has the maximum 12 photos." });
    // Another item and the job in general still have room.
    expect((await store.capture.saveShot({ ...DAN, itemId: "item-2" }, shot(files))).ok).toBe(true);
    expect(store.photos.countForJob("dan", "job-a")).toBe(13);
  });

  it("deleted photos free their place", async () => {
    const { store, files } = makeTestStore();
    for (let i = 0; i < 60; i++) await store.capture.saveShot(DAN, shot(files));
    const first = store.photos.listForJob("dan", "job-a")[0]!;
    await store.capture.deletePhoto("dan", first.id);
    expect((await store.capture.saveShot(DAN, shot(files))).ok).toBe(true);
  });

  it("is refused once the report is submitted", async () => {
    const { store, files, db } = makeTestStore();
    await store.capture.saveShot(DAN, shot(files));
    db.run("UPDATE drafts SET local_state = 'submitted'");
    expect(await store.capture.saveShot(DAN, shot(files))).toMatchObject({ ok: false, reason: "locked" });
  });
});

describe("storage (scenario 11)", () => {
  it.each([
    [600 * MB, "ok"],
    [499 * MB, "low"],
    [100 * MB, "low"],
    [99 * MB, "full"],
  ])("%i bytes free is %s", (free, status) => {
    const { store, files } = makeTestStore();
    files.free = free;
    expect(store.capture.storageStatus()).toBe(status);
  });

  it("under 500 MB capture still works; under 100 MB it is refused with the message", async () => {
    const { store, files } = makeTestStore();
    files.free = 400 * MB;
    expect((await store.capture.saveShot(DAN, shot(files))).ok).toBe(true);
    files.free = 90 * MB;
    const r = await store.capture.saveShot(DAN, shot(files));
    expect(r).toMatchObject({ ok: false, reason: "no_space", message: "Not enough space to save photos. Free up space on your phone." });
    expect(store.photos.countForJob("dan", "job-a")).toBe(1);
  });
});

describe("deleting (scenario 9)", () => {
  it("a photo the server never had loses its row and its files at once", async () => {
    const { store, files } = makeTestStore();
    const r = await store.capture.saveShot(DAN, shot(files));
    if (!r.ok) throw new Error();
    await store.capture.idle();
    expect(await store.capture.deletePhoto("dan", r.photo.id)).toBe("deleted");
    expect(store.photos.get("dan", r.photo.id)).toBeUndefined();
    expect([...files.entries.keys()].filter((k) => k.includes("/photos/"))).toEqual([]);
  });

  it.each(["registered", "sent"])("a %s photo is only flagged deleted; the files stay until the engine has told the server", async (state) => {
    const { store, files, db } = makeTestStore();
    const r = await store.capture.saveShot(DAN, shot(files));
    if (!r.ok) throw new Error();
    db.run("UPDATE photos SET sync_state = ? WHERE id = ?", [state, r.photo.id]);
    expect(await store.capture.deletePhoto("dan", r.photo.id)).toBe("kept_for_sync");
    expect(store.photos.get("dan", r.photo.id)!.deleted).toBe(1);
    expect(files.exists(r.photo.original_path)).toBe(true);
    expect(store.photos.countForJob("dan", "job-a")).toBe(0); // the counter drops
  });

  it("another user cannot delete the photo", async () => {
    const { store, files } = makeTestStore();
    const r = await store.capture.saveShot(DAN, shot(files));
    if (!r.ok) throw new Error();
    expect(await store.capture.deletePhoto("priya", r.photo.id)).toBe("missing");
    expect(store.photos.get("dan", r.photo.id)!.deleted).toBe(0);
  });

  it("a preview finishing after the photo was deleted leaves no stray file", async () => {
    const { store, files } = makeTestStore();
    const r = await store.capture.saveShot(DAN, shot(files));
    if (!r.ok) throw new Error();
    await store.capture.deletePhoto("dan", r.photo.id);
    await store.capture.idle();
    expect([...files.entries.keys()].filter((k) => k.includes("/photos/"))).toEqual([]);
  });
});
