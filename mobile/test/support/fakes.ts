import type { GalleryPicker, PickedAsset } from "../../src/capture/gallery";
import type { ImageTools, ResizedImage } from "../../src/capture/imageTools";
import type { MemoryPhotoFiles } from "./memoryFiles";

/** Records every resize and returns a small file so the caller can move it into the store. */
export class FakeImageTools implements ImageTools {
  calls: { sourceUri: string; maxEdge: number; quality: number }[] = [];
  fail = false;
  private n = 0;
  constructor(
    private readonly files: MemoryPhotoFiles,
    private readonly size = { width: 2560, height: 1920 },
  ) {}
  async resizeToJpeg(sourceUri: string, options: { maxEdge: number; quality: number }): Promise<ResizedImage> {
    this.calls.push({ sourceUri, ...options });
    if (this.fail) throw new Error("resize failed");
    this.n += 1;
    const uri = this.files.seed(`file:///cache/resized-${this.n}.jpg`, `resized-${this.n}-${options.maxEdge}`);
    return { uri, ...this.size };
  }
}

export class FakePicker implements GalleryPicker {
  next: PickedAsset[] | null = null;
  calls: { selectionLimit: number }[] = [];
  async pick(options: { selectionLimit: number }) {
    this.calls.push(options);
    return this.next;
  }
}
