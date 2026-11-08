import { FORBIDDEN, trimSpaces } from "../text/forbidden";

export const COMPANY_NAME_MAX = 60;

export const COMPANY_NAME_MESSAGES = {
  empty: "Enter a company name.",
  long: `Use ${COMPANY_NAME_MAX} characters or fewer.`,
  control: "Remove control characters.",
} as const;

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
