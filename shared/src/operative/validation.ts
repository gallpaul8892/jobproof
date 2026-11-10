/**
 * Operative free-text validators (T-003e caption; later tickets add item notes, job notes and the
 * sign-off name). Single-line rule shared with the customer fields: trim spaces, count code
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
