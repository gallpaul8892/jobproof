import { clampPan, clampScale, distance, pinchScale } from "./zoom";

interface Touch {
  pageX: number;
  pageY: number;
}

/** Double tap window and the zoom a double tap goes to. */
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_SCALE = 2.5;

/**
 * The state machine behind the viewer's pinch, drag and double-tap (no React, so it is tested
 * with plain calls). `onChange` is told the new scale and offset after every change.
 */
export class ZoomController {
  scale = 1;
  x = 0;
  y = 0;
  frameW = 1;
  frameH = 1;
  private startScale = 1;
  private startDistance = 0;
  private startX = 0;
  private startY = 0;
  private lastTap = 0;

  constructor(private readonly onChange: (scale: number, x: number, y: number) => void) {}

  setFrame(w: number, h: number): void {
    this.frameW = w;
    this.frameH = h;
  }

  apply(scale: number, x: number, y: number): void {
    this.scale = clampScale(scale);
    this.x = clampPan(x, this.scale, this.frameW);
    this.y = clampPan(y, this.scale, this.frameH);
    this.onChange(this.scale, this.x, this.y);
  }

  /** Take over the touch only for a pinch, or a drag of a zoomed picture. */
  wants(touchCount: number): boolean {
    return touchCount >= 2 || this.scale > 1;
  }

  grant(touches: readonly Touch[]): void {
    this.startScale = this.scale;
    this.startX = this.x;
    this.startY = this.y;
    this.startDistance = touches.length >= 2 ? distance(touches[0]!, touches[1]!) : 0;
  }

  move(touches: readonly Touch[], dx: number, dy: number): void {
    if (touches.length >= 2) {
      const d = distance(touches[0]!, touches[1]!);
      if (this.startDistance === 0) this.startDistance = d;
      this.apply(pinchScale(this.startScale, this.startDistance, d), this.x, this.y);
    } else if (this.scale > 1) {
      this.apply(this.scale, this.startX + dx, this.startY + dy);
    }
  }

  release(dx: number, dy: number, nowMs: number): void {
    const tapped = Math.abs(dx) < 6 && Math.abs(dy) < 6;
    if (!tapped) return;
    if (nowMs - this.lastTap < DOUBLE_TAP_MS) {
      this.apply(this.scale > 1 ? 1 : DOUBLE_TAP_SCALE, 0, 0);
      this.lastTap = 0;
    } else {
      this.lastTap = nowMs;
    }
  }
}
