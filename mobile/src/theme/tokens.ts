import { DEFAULT_THEME, contrastAgainstWhite, meetsAA, type Theme } from "@jobproof/shared";

export interface AppTheme {
  primary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  /** Text on `primary`: always white, which is why primary must reach 4.5:1 against white. */
  onPrimary: string;
}

export const ON_PRIMARY = "white";

/**
 * Branding colours to React Native style tokens. The server already enforces contrast, but a
 * stored snapshot could predate a rule change, so primary is re-checked here: header text is
 * white on primary and must stay readable.
 */
export function resolveTheme(theme: Theme | undefined): AppTheme {
  const t = theme && meetsAA(contrastAgainstWhite(theme.primary)) ? theme : DEFAULT_THEME;
  return { ...t, onPrimary: ON_PRIMARY };
}
