import { DEFAULT_THEME } from "./defaults";

export interface Preset {
  id: string;
  name: string;
  primary: string;
  accent: string;
}

/** Forest is the default theme (imported, not repeated). */
export const PRESETS: readonly Preset[] = [
  { id: "forest", name: "Forest", primary: DEFAULT_THEME.primary, accent: DEFAULT_THEME.accent },
  { id: "navy", name: "Navy", primary: "#1F3A5F", accent: "#2B4C7E" },
  { id: "charcoal", name: "Charcoal", primary: "#2B2B2B", accent: "#444444" },
  { id: "burgundy", name: "Burgundy", primary: "#7A1F2B", accent: "#8A2433" },
];

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** Accepts `#rrggbb` in any case and returns upper case; anything else is null. */
export function normaliseHex(input: string): string | null {
  const value = input.trim();
  return HEX.test(value) ? value.toUpperCase() : null;
}
