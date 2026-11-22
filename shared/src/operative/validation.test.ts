import { describe, expect, it } from "vitest";
import { CAPTION_MAX, ITEM_NOTE_MAX, JOB_NOTES_MAX, MSG_CAPTION_LENGTH, validateCaption, validateItemNote, validateJobNotes } from "./validation";

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

describe("validateItemNote and validateJobNotes (T-003f scenarios 2, 7, 11)", () => {
  it("accepts the example item note", () => {
    expect(validateItemNote("Needs second coat on window wall")).toEqual({ ok: true, value: "Needs second coat on window wall" });
  });
  it("treats blank, null and undefined as no note", () => {
    for (const v of ["", "  \n ", null, undefined]) {
      expect(validateItemNote(v)).toEqual({ ok: true, value: null });
      expect(validateJobNotes(v)).toEqual({ ok: true, value: null });
    }
  });
  it("accepts exactly 500 characters and refuses 501 with the message", () => {
    expect(validateItemNote("a".repeat(ITEM_NOTE_MAX)).ok).toBe(true);
    expect(validateItemNote("a".repeat(ITEM_NOTE_MAX + 1))).toEqual({ ok: false, message: "Keep it to 500 characters." });
  });
  it("accepts exactly 2,000 characters for the job note and refuses 2,001", () => {
    expect(validateJobNotes("a".repeat(JOB_NOTES_MAX)).ok).toBe(true);
    expect(validateJobNotes("a".repeat(JOB_NOTES_MAX + 1))).toEqual({ ok: false, message: "Keep it to 2,000 characters." });
  });
  it("keeps line breaks inside the text and drops them only at the ends", () => {
    expect(validateJobNotes("\nAll rooms done.\nCustomer happy.\n")).toEqual({ ok: true, value: "All rooms done.\nCustomer happy." });
  });
  it("counts an emoji as one character, like the server", () => {
    expect(validateItemNote("😀".repeat(ITEM_NOTE_MAX)).ok).toBe(true);
    expect(validateItemNote("😀".repeat(ITEM_NOTE_MAX + 1)).ok).toBe(false);
  });
  it("refuses NUL and lone surrogates, which the server cannot store", () => {
    expect(validateItemNote("a\u0000b")).toEqual({ ok: false, message: "Remove control characters." });
    expect(validateJobNotes("a\ud800b").ok).toBe(false);
  });
});
