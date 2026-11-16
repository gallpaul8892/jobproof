import { fitLongEdge } from "../src/capture/imageTools";

/**
 * Generated placeholder photos for the browser demo. Nothing is fetched: a picture is drawn on a
 * canvas and encoded as a JPEG data URL. The drawing code only needs the few canvas calls listed
 * here, so tests can run it against a recording fake.
 */
export interface Ctx2D {
  fillStyle: string | CanvasGradient;
  font: string;
  textAlign: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): { addColorStop(offset: number, colour: string): void } & CanvasGradient;
  drawImage(image: unknown, dx: number, dy: number, dw: number, dh: number): void;
}
export interface CanvasLike {
  width: number;
  height: number;
  getContext(kind: "2d"): Ctx2D | null;
  toDataURL(type: string, quality?: number): string;
}
export type CanvasFactory = (width: number, height: number) => CanvasLike;

export const browserCanvas: CanvasFactory = (width, height) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas as unknown as CanvasLike;
};

export interface PlaceholderSpec {
  /** Big caption, e.g. "Lounge wall". */
  title: string;
  /** Small line underneath, e.g. "Sample photo 3". */
  subtitle: string;
  /** Colour family 0-359; each sample gets its own so photos are easy to tell apart. */
  hue: number;
  width?: number;
  height?: number;
}

export interface PlaceholderImage {
  uri: string;
  width: number;
  height: number;
}

export const PLACEHOLDER_SIZE = { width: 1280, height: 960 } as const;

/** Draws a "freshly painted wall" scene: wall, skirting, a roller stripe and a label. */
export function drawPlaceholder(ctx: Ctx2D, w: number, h: number, spec: PlaceholderSpec): void {
  const wall = ctx.createLinearGradient(0, 0, w, h);
  wall.addColorStop(0, `hsl(${spec.hue}, 45%, 82%)`);
  wall.addColorStop(1, `hsl(${spec.hue}, 40%, 68%)`);
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = `hsl(${spec.hue}, 30%, 92%)`; // freshly painted stripe
  ctx.fillRect(w * 0.08, h * 0.12, w * 0.2, h * 0.58);
  ctx.fillStyle = `hsl(${spec.hue}, 25%, 38%)`; // floor
  ctx.fillRect(0, h * 0.82, w, h * 0.18);
  ctx.fillStyle = `hsl(${spec.hue}, 20%, 96%)`; // skirting board
  ctx.fillRect(0, h * 0.78, w, h * 0.04);
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(0, h * 0.4, w, h * 0.2);
  ctx.fillStyle = "white";
  ctx.textAlign = "center";
  ctx.font = `bold ${Math.round(h * 0.07)}px sans-serif`;
  ctx.fillText(spec.title, w / 2, h * 0.5);
  ctx.font = `${Math.round(h * 0.04)}px sans-serif`;
  ctx.fillText(spec.subtitle, w / 2, h * 0.57);
  ctx.fillText("Demo image drawn in your browser", w / 2, h * 0.94);
}

export function makePlaceholderJpeg(spec: PlaceholderSpec, factory: CanvasFactory = browserCanvas): PlaceholderImage {
  const width = spec.width ?? PLACEHOLDER_SIZE.width;
  const height = spec.height ?? PLACEHOLDER_SIZE.height;
  const canvas = factory(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw the demo photo (no canvas).");
  drawPlaceholder(ctx, width, height, spec);
  return { uri: canvas.toDataURL("image/jpeg", 0.8), width, height };
}

/** The few "gallery" pictures the demo offers. Generated on demand, so nothing is stored in the bundle. */
export const SAMPLE_IMAGES: readonly { id: string; title: string; hue: number }[] = [
  { id: "lounge", title: "Lounge wall", hue: 38 },
  { id: "hall", title: "Hallway and stairs", hue: 205 },
  { id: "kitchen", title: "Kitchen cabinet doors", hue: 150 },
  { id: "exterior", title: "Front elevation", hue: 15 },
];

export function sampleImage(index: number, factory: CanvasFactory = browserCanvas): PlaceholderImage & { fileName: string } {
  const sample = SAMPLE_IMAGES[((index % SAMPLE_IMAGES.length) + SAMPLE_IMAGES.length) % SAMPLE_IMAGES.length]!;
  const image = makePlaceholderJpeg({ title: sample.title, subtitle: "Sample photo from the demo gallery", hue: sample.hue }, factory);
  return { ...image, fileName: `${sample.id}.jpg` };
}

// ---- resizing ----------------------------------------------------------------------------------
export type ImageLoader = (uri: string) => Promise<{ width: number; height: number; source: unknown }>;

export const browserImageLoader: ImageLoader = (uri) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, source: img });
    img.onerror = () => reject(new Error("The demo could not read this image."));
    img.src = uri;
  });

/** ImageTools for the demo: decode, scale on a canvas, encode as JPEG. */
export class CanvasImageTools {
  constructor(
    private readonly factory: CanvasFactory = browserCanvas,
    private readonly load: ImageLoader = browserImageLoader,
  ) {}

  async resizeToJpeg(sourceUri: string, { maxEdge, quality }: { maxEdge: number; quality: number }): Promise<PlaceholderImage> {
    const image = await this.load(sourceUri);
    const size = fitLongEdge(image.width, image.height, maxEdge);
    const canvas = this.factory(size.width, size.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot resize images (no canvas).");
    ctx.drawImage(image.source, 0, 0, size.width, size.height);
    return { uri: canvas.toDataURL("image/jpeg", quality), width: size.width, height: size.height };
  }
}
