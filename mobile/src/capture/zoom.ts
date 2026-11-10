/** Pinch-zoom arithmetic for the photo viewer (pure, so it is tested without a screen). Zoom only: the viewer has no crop, rotate, filter or draw. */
export const MIN_SCALE = 1;
export const MAX_SCALE = 5;
export const ZOOM_STEP = 1.5;

export const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export function distance(a: { pageX: number; pageY: number }, b: { pageX: number; pageY: number }): number {
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

/** New scale when two fingers moved from `startDistance` apart to `current` apart. */
export function pinchScale(startScale: number, startDistance: number, current: number): number {
  if (startDistance <= 0) return startScale;
  return clampScale(startScale * (current / startDistance));
}

/** Keeps the picture covering the frame: at scale 1 no panning, at larger scales only the extra size. */
export function clampPan(offset: number, scale: number, frame: number): number {
  const limit = ((scale - 1) * frame) / 2;
  return Math.min(limit, Math.max(-limit, offset));
}

export const zoomIn = (s: number): number => clampScale(s * ZOOM_STEP);
export const zoomOut = (s: number): number => clampScale(s / ZOOM_STEP);
