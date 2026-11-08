export const COMPANY_NAME_MAX = 60;

export const COMPANY_NAME_MESSAGES = {
  empty: "Enter a company name.",
  long: `Use ${COMPANY_NAME_MAX} characters or fewer.`,
  control: "Remove control characters.",
} as const;

// Rejected anywhere in a name: U+0000-001F, U+007F-009F, and the invisible formatting characters
// U+200B-200F (zero width, direction marks), U+202A-202E (bidi embeddings and overrides),
// U+2066-2069 (bidi isolates), U+FEFF (byte order mark) and lone UTF-16 surrogates U+D800-U+DFFF.
// The `u` flag makes the class match code points, so a valid surrogate pair (an emoji) is one
// astral character and passes, while an unpaired surrogate is still matched.
// Twin of backend/app/schemas/settings.py.
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff\ud800-\udfff]/u;

/** Trim only the ordinary space, like the backend: String.trim() and str.strip() disagree elsewhere. */
function trimSpaces(raw: string): string {
  let start = 0;
  let end = raw.length;
  while (start < end && raw[start] === " ") start++;
  while (end > start && raw[end - 1] === " ") end--;
  return raw.slice(start, end);
}

export type CompanyNameResult = { value: string; error?: undefined } | { value?: undefined; error: string };

/** Same rules, order and messages as the backend: trim, then empty, length, control characters. */
export function validateCompanyName(raw: string): CompanyNameResult {
  const value = trimSpaces(raw);
  if (value === "") return { error: COMPANY_NAME_MESSAGES.empty };
  if (Array.from(value).length > COMPANY_NAME_MAX) return { error: COMPANY_NAME_MESSAGES.long };
  if (FORBIDDEN.test(value)) return { error: COMPANY_NAME_MESSAGES.control };
  return { value };
}

/** Length in code points, for the "12 / 60" counter. */
export function nameLength(raw: string): number {
  return Array.from(trimSpaces(raw)).length;
}
