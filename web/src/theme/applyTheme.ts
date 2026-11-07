import { DEFAULT_THEME, type Theme } from "@jobproof/shared";

// The only code that writes theme styles. It uses the CSSOM (setProperty), which the CSP does
// not govern, so no inline <style> or style="" markup is needed (ARCHITECTURE.md 9.2).
const HEX = /^#[0-9A-F]{6}$/;

export const THEME_PROPERTIES = {
  primary: "--jp-primary",
  accent: "--jp-accent",
  background: "--jp-bg",
  surface: "--jp-surface",
  text: "--jp-text",
} as const satisfies Record<keyof Theme, string>;

/** Each value must be `#RRGGBB` upper case; anything else falls back to the default for that token. */
export function safeTheme(theme: Partial<Record<keyof Theme, unknown>>): Theme {
  const result = { ...DEFAULT_THEME };
  for (const key of Object.keys(THEME_PROPERTIES) as (keyof Theme)[]) {
    const value = theme[key];
    if (typeof value === "string" && HEX.test(value)) result[key] = value;
  }
  return result;
}

export function applyTheme(theme: Partial<Record<keyof Theme, unknown>>, root: HTMLElement = document.documentElement): void {
  const safe = safeTheme(theme);
  for (const key of Object.keys(THEME_PROPERTIES) as (keyof Theme)[]) {
    root.style.setProperty(THEME_PROPERTIES[key], safe[key]);
  }
}
