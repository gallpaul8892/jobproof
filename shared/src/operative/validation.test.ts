import { describe, expect, it } from "vitest";
import { CAPTION_MAX, MSG_CAPTION_LENGTH, validateCaption } from "./validation";

describe("validateCaption (T-003e scenario 7)", () => {
  it("accepts the example caption and trims spaces", () => {
    expect(validateCaption("  Damp patch above window ")).toEqual({ ok: true, value: "Damp patch above window" });
  });
  it("treats blank, null and undefined as no caption (never required)", () => {
    for (const v of ["", "   ", null, undefined]) expect(validateCaption(v)).toEqual({ ok: true, value: null });
  });
  it("accepts exactly 140 characters and refuses 141 with the message", () => {
    expect(validateCaption("a".repeat(CAPTION_MAX)).ok).toBe(true);
    expect(validateCaption("a".repeat(CAPTION_MAX + 1))).toEqual({ ok: false, message: "Keep it to 140 characters." });
    expect(MSG_CAPTION_LENGTH).toBe("Keep it to 140 characters.");
  });
  it("counts an emoji as one character", () => {
    expect(validateCaption("😀".repeat(CAPTION_MAX)).ok).toBe(true);
    expect(validateCaption("😀".repeat(CAPTION_MAX + 1)).ok).toBe(false);
  });
  it("refuses newlines and invisible formatting characters", () => {
    expect(validateCaption("two\nlines").ok).toBe(false);
    expect(validateCaption("a‮b").ok).toBe(false);
  });
});
