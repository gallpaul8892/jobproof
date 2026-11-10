import { DOUBLE_TAP_SCALE, ZoomController } from "./zoomController";

const touch = (x: number, y = 0) => ({ pageX: x, pageY: y });
function make() {
  const seen: [number, number, number][] = [];
  const c = new ZoomController((s, x, y) => seen.push([s, x, y]));
  c.setFrame(300, 300);
  return { c, seen };
}

describe("ZoomController", () => {
  it("pinches out to zoom and back", () => {
    const { c } = make();
    c.grant([touch(0), touch(100)]);
    c.move([touch(-50), touch(150)], 0, 0);
    expect(c.scale).toBe(2);
    c.grant([touch(0), touch(200)]);
    c.move([touch(50), touch(150)], 0, 0);
    expect(c.scale).toBe(1);
  });
  it("only takes over a one-finger touch when zoomed", () => {
    const { c } = make();
    expect(c.wants(1)).toBe(false);
    expect(c.wants(2)).toBe(true);
    c.apply(2, 0, 0);
    expect(c.wants(1)).toBe(true);
  });
  it("drags a zoomed picture but not past its edges", () => {
    const { c } = make();
    c.apply(2, 0, 0);
    c.grant([touch(0)]);
    c.move([touch(10)], 40, -500);
    expect([c.x, c.y]).toEqual([40, -150]);
  });
  it("ignores a one-finger drag at scale 1", () => {
    const { c, seen } = make();
    c.grant([touch(0)]);
    c.move([touch(10)], 40, 40);
    expect(seen).toHaveLength(0);
  });
  it("double tap zooms in, another resets", () => {
    const { c } = make();
    c.release(0, 0, 1000);
    c.release(0, 0, 1200);
    expect(c.scale).toBe(DOUBLE_TAP_SCALE);
    c.release(0, 0, 5000);
    c.release(0, 0, 5100);
    expect(c.scale).toBe(1);
  });
  it("two slow taps or a drag are not a double tap", () => {
    const { c } = make();
    c.release(0, 0, 1000);
    c.release(0, 0, 2000);
    c.release(30, 0, 2100);
    expect(c.scale).toBe(1);
  });
  it("never reports a scale outside 1 to 5", () => {
    const { c } = make();
    c.apply(99, 0, 0);
    expect(c.scale).toBe(5);
    c.apply(0, 0, 0);
    expect(c.scale).toBe(1);
  });
});
