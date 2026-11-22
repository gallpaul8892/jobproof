/**
 * Operative free-text validators (T-003e caption, T-003f item note and job notes; a later ticket
 * adds the sign-off name). Single-line rule shared with the customer fields: trim spaces, count code
 * points, refuse control and invisible characters.
 */
import { MSG_CONTROL, codePointLength, containsForbiddenCharacter, trimSpaces } from "../text/forbidden";
import type { ValidationResult } from "../customer/validation";

export const CAPTION_MAX = 140;
export const MSG_CAPTION_LENGTH = `Keep it to ${CAPTION_MAX} characters.`;

/** A photo caption is optional: blank is stored as null. The input text is never altered by a failure. */
export function validateCaption(raw: string | null | undefined): ValidationResult {
  const value = trimSpaces(raw ?? "");
  if (value === "") return { ok: true, value: null };
  if (codePointLength(value) > CAPTION_MAX) return { ok: false, message: MSG_CAPTION_LENGTH };
  if (containsForbiddenCharacter(value)) return { ok: false, message: MSG_CONTROL };
  return { ok: true, value };
}

export const ITEM_NOTE_MAX = 500;
export const JOB_NOTES_MAX = 2000;
export const MSG_ITEM_NOTE_LENGTH = `Keep it to ${ITEM_NOTE_MAX} characters.`;
export const MSG_JOB_NOTES_LENGTH = "Keep it to 2,000 characters.";

// Multi-line rule, twin of backend `reject_unstorable`: new lines and tabs are fine; only NUL and
// lone UTF-16 surrogates (which cannot be stored) are refused.
// eslint-disable-next-line no-control-regex
const UNSTORABLE = /[\u0000\ud800-\udfff]/u;

/** Blank means "no text" (stored as null); only spaces, tabs and line breaks at the ends are dropped. */
function validateMultiLine(raw: string | null | undefined, max: number, tooLong: string): ValidationResult {
  const value = (raw ?? "").replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
  if (value === "") return { ok: true, value: null };
  if (codePointLength(value) > max) return { ok: false, message: tooLong };
  if (UNSTORABLE.test(value)) return { ok: false, message: MSG_CONTROL };
  return { ok: true, value };
}

/** A note on one checklist item or a not-done reason (500, multi-line). The input text is never altered by a failure. */
export function validateItemNote(raw: string | null | undefined): ValidationResult {
  return validateMultiLine(raw, ITEM_NOTE_MAX, MSG_ITEM_NOTE_LENGTH);
}

/** The overall job note (2,000, multi-line). */
export function validateJobNotes(raw: string | null | undefined): ValidationResult {
  return validateMultiLine(raw, JOB_NOTES_MAX, MSG_JOB_NOTES_LENGTH);
}
