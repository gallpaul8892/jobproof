// WCAG 2.2 contrast maths. Twin of backend/app/branding/contrast.py; both are tested against
// the same table of cases.

export const REQUIRED_RATIO = 4.5;
// Relative luminance of white, one of the two backgrounds the rule uses. No hex literal here: white is a default theme colour and only
// defaults.ts may hold those (T-002a scenario 5).
const WHITE_LUMINANCE = 1;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function contrastAgainstWhite(hex: string): number {
  return (WHITE_LUMINANCE + 0.05) / (relativeLuminance(hex) + 0.05);
}

export type Background = "white" | "surface";

/**
 * The lower of the contrast against white and against the surface colour, and which one it is.
 * Accent and primary text sit on both, so both must reach 4.5:1 (T-002e, D6).
 */
export function weakestContrast(hex: string, surface: string): { ratio: number; background: Background } {
  const onWhite = contrastAgainstWhite(hex);
  const onSurface = contrastRatio(hex, surface);
  return onWhite <= onSurface ? { ratio: onWhite, background: "white" } : { ratio: onSurface, background: "surface" };
}

/** Compared unrounded: 4.4999 fails even though it displays as 4.50. */
export function meetsAA(ratio: number): boolean {
  return ratio >= REQUIRED_RATIO;
}

/** Two decimals half-up; a failing ratio is never reported as 4.50 (it becomes 4.49). */
export function reportRatio(ratio: number): number {
  const rounded = Math.round((ratio + Number.EPSILON) * 100) / 100;
  return !meetsAA(ratio) && rounded >= REQUIRED_RATIO ? 4.49 : rounded;
}

export function formatRatio(ratio: number): string {
  return reportRatio(ratio).toFixed(2);
}
