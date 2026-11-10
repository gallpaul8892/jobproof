import { MAX_SCALE, MIN_SCALE, clampPan, clampScale, distance, pinchScale, zoomIn, zoomOut } from "./zoom";

describe("zoom arithmetic", () => {
  it("clamps the scale", () => {
    expect(clampScale(0.2)).toBe(MIN_SCALE);
    expect(clampScale(99)).toBe(MAX_SCALE);
  });
  it("scales with the fingers' distance", () => {
    expect(pinchScale(1, 100, 200)).toBe(2);
    expect(pinchScale(2, 200, 100)).toBe(1);
    expect(pinchScale(1, 100, 10000)).toBe(MAX_SCALE);
    expect(pinchScale(3, 0, 50)).toBe(3);
  });
  it("measures the distance between two touches", () => {
    expect(distance({ pageX: 0, pageY: 0 }, { pageX: 3, pageY: 4 })).toBe(5);
  });
  it("allows no panning at scale 1 and only the extra size when zoomed", () => {
    expect(clampPan(50, 1, 300)).toBe(0);
    expect(clampPan(500, 2, 300)).toBe(150);
    expect(clampPan(-500, 2, 300)).toBe(-150);
    expect(clampPan(20, 2, 300)).toBe(20);
  });
  it("buttons step up and down within the limits", () => {
    expect(zoomIn(1)).toBe(1.5);
    expect(zoomOut(1)).toBe(1);
    expect(zoomIn(MAX_SCALE)).toBe(MAX_SCALE);
  });
});
