import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { ImageTools, ResizedImage } from "./imageTools";

/**
 * ImageTools over expo-image-manipulator ~58 (contextual API). The source is decoded already
 * downsampled (`maxWidth`/`maxHeight`), so a 12 MP original is never held in memory at full size;
 * if the decoder could only get "close", a second exact resize makes sure the limit holds.
 */
export class ExpoImageTools implements ImageTools {
  async resizeToJpeg(sourceUri: string, { maxEdge, quality }: { maxEdge: number; quality: number }): Promise<ResizedImage> {
    let ref = await ImageManipulator.manipulate(sourceUri, { maxWidth: maxEdge, maxHeight: maxEdge }).renderAsync();
    if (Math.max(ref.width, ref.height) > maxEdge) {
      const landscape = ref.width >= ref.height;
      ref = await ImageManipulator.manipulate(ref)
        .resize(landscape ? { width: maxEdge } : { height: maxEdge })
        .renderAsync();
    }
    const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: quality });
    return { uri: saved.uri, width: saved.width, height: saved.height };
  }
}
