import { DEFAULT_THEME } from "@jobproof/shared";
import { resolveTheme } from "./tokens";

describe("resolveTheme", () => {
  it("uses the default theme without branding", () => {
    expect(resolveTheme(undefined)).toEqual({ ...DEFAULT_THEME, onPrimary: "white" });
  });
  it("uses the company theme when primary is readable under white text", () => {
    const theme = { ...DEFAULT_THEME, primary: "#003366" };
    expect(resolveTheme(theme).primary).toBe("#003366");
  });
  it("falls back to the default when primary is too light for white text", () => {
    const theme = { ...DEFAULT_THEME, primary: "#FFEE00" };
    expect(resolveTheme(theme).primary).toBe(DEFAULT_THEME.primary);
  });
});
