import type { CanvasFactory, CanvasLike, Ctx2D, ImageLoader } from "./placeholder";

/** Test helpers for the demo: a canvas that records what is drawn, and an image loader that never touches the network. */
export interface FakeCanvasRecord {
  width: number;
  height: number;
  texts: string[];
  drawImages: number;
  encoded: { type: string; quality?: number }[];
}

export function fakeCanvasFactory(): { factory: CanvasFactory; made: FakeCanvasRecord[] } {
  const made: FakeCanvasRecord[] = [];
  let serial = 0;
  const factory: CanvasFactory = (width, height) => {
    const record: FakeCanvasRecord = { width, height, texts: [], drawImages: 0, encoded: [] };
    made.push(record);
    const ctx: Ctx2D = {
      fillStyle: "",
      font: "",
      textAlign: "",
      fillRect: () => undefined,
      fillText: (text) => void record.texts.push(text),
      createLinearGradient: () => ({ addColorStop: () => undefined }) as never,
      drawImage: () => void (record.drawImages += 1),
    };
    const canvas: CanvasLike = {
      width,
      height,
      getContext: () => ctx,
      toDataURL: (type, quality) => {
        record.encoded.push({ type, quality });
        serial += 1;
        // A tiny but real base64 payload, different for every picture.
        return `data:${type};base64,${btoa(`fake-jpeg-${serial}-${width}x${height}`)}`;
      },
    };
    return canvas;
  };
  return { factory, made };
}

/** Pretends every image is `width` x `height`. */
export const fakeImageLoader =
  (width: number, height: number): ImageLoader =>
  async () => ({ width, height, source: {} });
