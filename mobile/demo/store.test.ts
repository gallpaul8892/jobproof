import { PhotoCapture } from "../src/capture/captureService";
import { SqliteUnsentItemsSource } from "../src/db/unsentSource";
import { PhotoRepo } from "../src/db/photoRepo";
import { applyPragmas, migrate } from "../src/db/migrations";
import { cleanUpPhotoStorage } from "../src/files/orphans";
import { MemoryDb } from "./memoryDb";
import { dataUrlBytes, MemoryDemoFiles } from "./memoryFiles";
import { CanvasImageTools, sampleImage } from "./placeholder";
import { SamplePicker } from "./samplePicker";
import { fakeCanvasFactory, fakeImageLoader } from "./support";

const OWNER = "dan-0001";

function setup() {
  const db = new MemoryDb();
  applyPragmas(db);
  migrate(db);
  const repo = new PhotoRepo(db);
  const files = new MemoryDemoFiles(() => 1_700_000_000_000);
  const { factory } = fakeCanvasFactory();
  const tools = new CanvasImageTools(factory, fakeImageLoader(1280, 960));
  let n = 0;
  const capture = new PhotoCapture({ repo, files, tools, newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, now: () => new Date("2026-11-15T09:00:00Z") });
  return { db, repo, files, capture, factory };
}

describe("the demo's local store, running the app's own capture code", () => {
  it("saves a camera shot as a file and a row, then makes its preview", async () => {
    const { repo, files, capture, factory } = setup();
    const shot = sampleImage(0, factory);
    const result = await capture.saveShot({ ownerUserId: OWNER, jobId: "job-1", stage: "before" }, shot);
    expect(result.ok).toBe(true);
    await capture.idle();
    const rows = repo.listForJob(OWNER, "job-1");
    expect(rows).toHaveLength(1);
    expect(files.exists(rows[0]!.original_path)).toBe(true);
    expect(rows[0]!.thumb_path).not.toBeNull();
    expect(files.uri(rows[0]!.original_path)).toBe(shot.uri); // an <Image> can show it as is
    expect(repo.reportState(OWNER, "job-1")).toBe("draft");
    expect(new SqliteUnsentItemsSource(repo["db"]).summaryFor(OWNER)).toEqual({ photos: 1, reports: 0 }); // the app's honest "not sent" state
  });

  it("imports picked sample photos and counts the ones it cannot read", async () => {
    const { repo, capture, factory } = setup();
    const picker = new SamplePicker(async () => [0, 1], factory);
    const assets = (await picker.pick({ selectionLimit: 5 }))!;
    expect(assets).toHaveLength(2);
    const bad = { uri: "file:///not-a-data-url.jpg", type: "image", mimeType: "image/jpeg" };
    const summary = await capture.importAssets({ ownerUserId: OWNER, jobId: "job-1", stage: "after" }, [...assets, bad]);
    expect(summary).toMatchObject({ added: 2, skipped: 1 });
    expect(repo.countForJob(OWNER, "job-1")).toBe(2);
  });

  it("the picker returns nothing when the visitor cancels, and never more than the limit", async () => {
    const { factory } = setup();
    expect(await new SamplePicker(async () => null, factory).pick({ selectionLimit: 3 })).toBeNull();
    expect(await new SamplePicker(async () => [], factory).pick({ selectionLimit: 3 })).toBeNull();
    expect(await new SamplePicker(async () => [0, 1, 2], factory).pick({ selectionLimit: 2 })).toHaveLength(2);
  });

  it("start-up cleanup turns a file with no row back into a photo, like the real store", async () => {
    const { repo, files, factory } = setup();
    repo.setCaptureIntent(OWNER, "job-1");
    await files.moveTo(sampleImage(1, factory).uri, `photos/${OWNER}/00000000-0000-4000-8000-0000000000aa.jpg`);
    cleanUpPhotoStorage({ repo, files, ownerUserId: OWNER });
    expect(repo.countForJob(OWNER, "job-1")).toBe(1);
  });
});

describe("MemoryDemoFiles", () => {
  it("copies atomically, renames, lists, removes and reports sizes", async () => {
    const { files, factory } = setup();
    const uri = sampleImage(0, factory).uri;
    await files.copyTo(uri, "photos/u/a.jpg.part");
    files.rename("photos/u/a.jpg.part", "a.jpg");
    expect(files.list("photos/u")).toEqual(["a.jpg"]);
    expect(files.size("photos/u/a.jpg")).toBe(dataUrlBytes(uri).length);
    expect(files.modifiedAt("photos/u/a.jpg")).toBe(1_700_000_000_000);
    await expect(files.moveTo(uri, "photos/u/a.jpg")).rejects.toThrow(/exists/);
    files.remove("photos/u/a.jpg");
    files.remove("photos/u/a.jpg"); // removing a missing file is not an error
    expect(files.exists("photos/u/a.jpg")).toBe(false);
    expect(files.size("photos/u/a.jpg")).toBeNull();
  });

  it("only reads pictures it made itself: no file paths, no web addresses", async () => {
    const { files } = setup();
    await expect(files.copyTo("file:///etc/passwd", "photos/u/x.jpg")).rejects.toThrow();
    await expect(files.copyTo("https://example.com/x.jpg", "photos/u/x.jpg")).rejects.toThrow();
  });

  it("hashes with SHA-256", async () => {
    const { files } = setup();
    await files.copyTo(`data:text/plain;base64,${btoa("abc")}`, "photos/u/h.jpg");
    expect(await files.sha256("photos/u/h.jpg")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("pretends to have plenty of storage so the demo never shows the low-storage banner", () => {
    expect(setup().files.availableBytes()).toBeGreaterThan(1024 ** 3);
  });
});
