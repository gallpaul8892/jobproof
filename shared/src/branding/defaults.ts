// The only web/mobile copy of the default theme; must equal backend/app/branding/defaults.py
// (tested by backend/tests/test_no_hardcoded_branding.py). There is deliberately no default
// company name here: the UI shows nothing until /branding answers (T-002a, A2).
import type { Theme } from "../generated";

export const DEFAULT_THEME: Theme = {
  primary: "#1F5130",
  accent: "#2F5D3A",
  background: "#FFFFFF",
  surface: "#F4F7F2",
  text: "#1B1F1C",
};
