import { describe, expect, it } from "vitest";
import { DEFAULT_THEME } from "./defaults";
import {
  contrastAgainstWhite,
  contrastRatio,
  formatRatio,
  meetsAA,
  relativeLuminance,
  reportRatio,
} from "./contrast";
import { PRESETS, normaliseHex } from "./presets";
import { validateCompanyName } from "./companyName";

// The same table as backend/tests/test_contrast.py: [colour, reported ratio vs white, passes].
const CASES: [string, number | null, boolean][] = [
  ["#1F5130", 9.22, true],
  ["#2F5D3A", 7.64, true],
  ["#1B1F1C", 16.68, true],
  ["#767676", 4.54, true],
  ["#777777", 4.48, false],
  ["#4CAF50", 2.78, false],
  ["#FFD400", 1.43, false],
  ["#1F3A5F", null, true],
  ["#2B2B2B", 14.16, true],
  ["#444444", 9.74, true],
  ["#7A1F2B", 10.2, true],
];

describe("contrast", () => {
  it.each(CASES)("%s against white", (colour, reported, passes) => {
    const ratio = contrastAgainstWhite(colour);
    expect(meetsAA(ratio)).toBe(passes);
    if (reported !== null) expect(reportRatio(ratio)).toBe(reported);
  });

  it("white is 1:1 with itself and black is 21:1", () => {
    expect(contrastAgainstWhite("#FFFFFF")).toBeCloseTo(1, 10);
    expect(contrastAgainstWhite("#000000")).toBeCloseTo(21, 10);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 10);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#1F5130", "#F4F7F2")).toBeCloseTo(contrastRatio("#F4F7F2", "#1F5130"), 10);
  });

  it("compares unrounded and never reports a failing ratio as 4.50", () => {
    expect(meetsAA(4.5)).toBe(true);
    expect(meetsAA(4.499999)).toBe(false);
    expect(reportRatio(4.499999)).toBe(4.49);
    expect(reportRatio(4.5)).toBe(4.5);
    expect(reportRatio(4.504)).toBe(4.5);
    expect(reportRatio(2.775)).toBe(2.78);
    expect(formatRatio(1.4)).toBe("1.40");
  });
});

describe("default theme and presets", () => {
  it("default pairs are all at least 4.5:1", () => {
    const t = DEFAULT_THEME;
    for (const [a, b] of [
      ["#FFFFFF", t.primary],
      [t.accent, t.background],
      [t.accent, t.surface],
      [t.text, t.background],
      [t.text, t.surface],
    ] as const) {
      expect(contrastRatio(a, b), `${a} on ${b}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("every preset colour passes AA against white", () => {
    expect(PRESETS.map((p) => p.id)).toEqual(["forest", "navy", "charcoal", "burgundy"]);
    for (const p of PRESETS) {
      expect(meetsAA(contrastAgainstWhite(p.primary)), p.id).toBe(true);
      expect(meetsAA(contrastAgainstWhite(p.accent)), p.id).toBe(true);
    }
    expect(reportRatio(contrastAgainstWhite("#2B4C7E"))).toBe(8.61);
    expect(reportRatio(contrastAgainstWhite("#8A2433"))).toBe(8.82);
    expect(PRESETS[0]).toMatchObject({ primary: DEFAULT_THEME.primary, accent: DEFAULT_THEME.accent });
  });

  it("normaliseHex accepts #rrggbb in any case only", () => {
    expect(normaliseHex("#1f5130")).toBe("#1F5130");
    expect(normaliseHex(" #1F5130 ")).toBe("#1F5130");
    for (const bad of ["green", "#12345", "#GGGGGG", "1F5130", "", "#1F51301"]) expect(normaliseHex(bad)).toBeNull();
  });
});

describe("validateCompanyName", () => {
  it.each([
    ["", "Enter a company name."],
    ["   ", "Enter a company name."],
    ["x".repeat(61), "Use 60 characters or fewer."],
    ["\u{1F3A8}".repeat(61), "Use 60 characters or fewer."],
    ["A\u0000B", "Remove control characters."],
    ["A\nB", "Remove control characters."],
    ["A\u0085B", "Remove control characters."],
  ])("rejects %j", (raw, message) => {
    expect(validateCompanyName(raw)).toEqual({ error: message });
  });

  it("trims and accepts 60 code points", () => {
    expect(validateCompanyName("  Oak Ltd  ")).toEqual({ value: "Oak Ltd" });
    expect(validateCompanyName("y".repeat(60))).toEqual({ value: "y".repeat(60) });
    expect(validateCompanyName("\u{1F3A8}".repeat(60)).value).toBeDefined();
    expect(validateCompanyName("<script>alert(1)</script> & Sons").value).toBe("<script>alert(1)</script> & Sons");
  });
});
