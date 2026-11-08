// Rejected anywhere in a free-text single-line value: U+0000-001F, U+007F-009F, and the invisible
// formatting characters U+200B-200F (zero width, direction marks), U+202A-202E (bidi embeddings and
// overrides), U+2066-2069 (bidi isolates), U+FEFF (byte order mark) and lone UTF-16 surrogates
// U+D800-U+DFFF. The `u` flag makes the class match code points, so a valid surrogate pair (an
// emoji) is one astral character and passes, while an unpaired surrogate is still matched.
// Twin of backend/app/schemas/text.py (company name T-002c, customer fields T-002n).
// eslint-disable-next-line no-control-regex
export const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff\ud800-\udfff]/u;

export const MSG_CONTROL = "Remove control characters.";

export function containsForbiddenCharacter(value: string): boolean {
  return FORBIDDEN.test(value);
}

/** Trim only the ordinary space, like the backend: String.trim() and str.strip() disagree elsewhere. */
export function trimSpaces(raw: string): string {
  let start = 0;
  let end = raw.length;
  while (start < end && raw[start] === " ") start++;
  while (end > start && raw[end - 1] === " ") end--;
  return raw.slice(start, end);
}

/** Length in code points, the way the server counts. */
export function codePointLength(value: string): number {
  return Array.from(value).length;
}
