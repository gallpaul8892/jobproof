export const COMPANY_NAME_MAX = 60;

export const COMPANY_NAME_MESSAGES = {
  empty: "Enter a company name.",
  long: `Use ${COMPANY_NAME_MAX} characters or fewer.`,
  control: "Remove control characters.",
} as const;

// Unicode category Cc: U+0000 to U+001F and U+007F to U+009F.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export type CompanyNameResult = { value: string; error?: undefined } | { value?: undefined; error: string };

/** Same rules, order and messages as the backend: trim, then empty, length, control characters. */
export function validateCompanyName(raw: string): CompanyNameResult {
  const value = raw.trim();
  if (value === "") return { error: COMPANY_NAME_MESSAGES.empty };
  if (Array.from(value).length > COMPANY_NAME_MAX) return { error: COMPANY_NAME_MESSAGES.long };
  if (CONTROL.test(value)) return { error: COMPANY_NAME_MESSAGES.control };
  return { value };
}

/** Length in code points, for the "12 / 60" counter. */
export function nameLength(raw: string): number {
  return Array.from(raw.trim()).length;
}
