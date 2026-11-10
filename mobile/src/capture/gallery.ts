/** One picked gallery item, as much as the picker tells us. */
export interface PickedAsset {
  uri: string;
  width?: number;
  height?: number;
  type?: string | null;
  mimeType?: string;
  fileName?: string | null;
  exif?: Record<string, unknown> | null;
}

/**
 * GalleryPicker: the system photo picker (no storage permission needed, design 3.6 step 5),
 * behind an interface. `null` means the operative closed the picker without choosing.
 */
export interface GalleryPicker {
  pick(options: { selectionLimit: number }): Promise<PickedAsset[] | null>;
}
