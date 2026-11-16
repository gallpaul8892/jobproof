import { CanvasImageTools, SAMPLE_IMAGES, makePlaceholderJpeg, sampleImage } from "./placeholder";
import { fakeCanvasFactory, fakeImageLoader } from "./support";

describe("placeholder pictures", () => {
  it("draws a labelled picture and encodes it as a JPEG data URL", () => {
    const { factory, made } = fakeCanvasFactory();
    const image = makePlaceholderJpeg({ title: "Lounge wall", subtitle: "Sample photo", hue: 40 }, factory);
    expect(image.uri.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect([image.width, image.height]).toEqual([1280, 960]);
    expect(made[0]!.texts).toEqual(["Lounge wall", "Sample photo", "Demo image drawn in your browser"]);
    expect(made[0]!.encoded[0]!.type).toBe("image/jpeg");
  });

  it("says so clearly when the browser has no canvas", () => {
    expect(() => makePlaceholderJpeg({ title: "x", subtitle: "y", hue: 0 }, () => ({ width: 1, height: 1, getContext: () => null, toDataURL: () => "" }))).toThrow(/no canvas/);
  });

  it("offers a few sample images and wraps around the list", () => {
    const { factory } = fakeCanvasFactory();
    expect(SAMPLE_IMAGES.length).toBeGreaterThanOrEqual(3);
    expect(sampleImage(0, factory).fileName).toBe(`${SAMPLE_IMAGES[0]!.id}.jpg`);
    expect(sampleImage(SAMPLE_IMAGES.length, factory).fileName).toBe(`${SAMPLE_IMAGES[0]!.id}.jpg`);
    expect(sampleImage(-1, factory).fileName).toBe(`${SAMPLE_IMAGES[SAMPLE_IMAGES.length - 1]!.id}.jpg`);
  });
});

describe("CanvasImageTools", () => {
  it("scales the long edge down to the limit and keeps the shape", async () => {
    const { factory, made } = fakeCanvasFactory();
    const tools = new CanvasImageTools(factory, fakeImageLoader(4000, 3000));
    const out = await tools.resizeToJpeg("data:image/jpeg;base64,AAAA", { maxEdge: 2560, quality: 0.8 });
    expect([out.width, out.height]).toEqual([2560, 1920]);
    expect(made[0]!.drawImages).toBe(1);
    expect(made[0]!.encoded[0]).toEqual({ type: "image/jpeg", quality: 0.8 });
  });

  it("never enlarges a small picture", async () => {
    const { factory } = fakeCanvasFactory();
    const out = await new CanvasImageTools(factory, fakeImageLoader(640, 480)).resizeToJpeg("data:,", { maxEdge: 2560, quality: 0.8 });
    expect([out.width, out.height]).toEqual([640, 480]);
  });
});
