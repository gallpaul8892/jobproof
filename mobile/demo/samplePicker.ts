import type { GalleryPicker, PickedAsset } from "../src/capture/gallery";
import { SAMPLE_IMAGES, sampleImage, type CanvasFactory, browserCanvas } from "./placeholder";

/** Asks the visitor which sample pictures to add: indexes into SAMPLE_IMAGES, or null when they cancel. */
export type SampleChooser = (samples: typeof SAMPLE_IMAGES, limit: number) => Promise<number[] | null>;

/**
 * The demo's "gallery": the phone's photo picker is replaced by a short list of bundled sample
 * pictures. Each pick becomes a PickedAsset exactly as the system picker would give one (with the
 * time it was "taken" in EXIF), so the app's own import path runs unchanged.
 */
export class SamplePicker implements GalleryPicker {
  constructor(
    private readonly choose: SampleChooser,
    private readonly factory: CanvasFactory = browserCanvas,
  ) {}

  async pick({ selectionLimit }: { selectionLimit: number }): Promise<PickedAsset[] | null> {
    const chosen = await this.choose(SAMPLE_IMAGES, selectionLimit);
    if (!chosen || chosen.length === 0) return null;
    return chosen.slice(0, selectionLimit).map((index) => {
      const image = sampleImage(index, this.factory);
      return { uri: image.uri, width: image.width, height: image.height, type: "image", mimeType: "image/jpeg", fileName: image.fileName, exif: null };
    });
  }
}
