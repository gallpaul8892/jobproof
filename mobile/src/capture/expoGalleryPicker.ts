import { launchImageLibraryAsync } from "expo-image-picker";
import type { GalleryPicker, PickedAsset } from "./gallery";

/** The Android system photo picker: images only, several at once, EXIF included so the original time is kept. */
export class ExpoGalleryPicker implements GalleryPicker {
  async pick({ selectionLimit }: { selectionLimit: number }): Promise<PickedAsset[] | null> {
    const result = await launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit,
      exif: true,
      quality: 1, // no re-compression: the original is evidence
    });
    return result.canceled ? null : result.assets;
  }
}
