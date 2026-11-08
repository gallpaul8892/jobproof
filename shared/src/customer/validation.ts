/**
 * Customer field validators (T-002n, D10). Twin of backend/app/schemas/customer_write.py: both are
 * driven by the same case table, validationCases.json. Each takes the raw value and returns the value
 * to store (normalised) or the message to show.
 */
import { MSG_CONTROL, codePointLength, containsForbiddenCharacter, trimSpaces } from "../text/forbidden";

export const NAME_MAX = 120;
export const CONTACT_NAME_MAX = 120;
export const EMAIL_MAX = 254;
export const PHONE_MAX = 30;
export const LINE_MAX = 100;
export const TOWN_MAX = 60;
export const COUNTY_MAX = 60;
export const POSTCODE_RAW_MAX = 10;

export const MSG_NAME = "Enter a name.";
export const MSG_EMAIL = "Enter an email address such as name@example.co.uk.";
export const MSG_PHONE = "Enter a UK phone number such as 07700 900123, or an international number starting with +.";
export const MSG_LINE1 = "Enter the first line of the address.";
export const MSG_TOWN = "Enter a town or city.";
export const MSG_POSTCODE = "Enter a UK postcode such as BS6 5QA.";

export type ValidationResult = { ok: true; value: string | null } | { ok: false; message: string };

export type CustomerField =
  | "name"
  | "contact_name"
  | "email"
  | "phone"
  | "line1"
  | "line2"
  | "town"
  | "county"
  | "postcode";

const EMAIL = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
const PHONE_CHARS = /^\+?[0-9 ()-]+$/;
const UK_LOCAL = /^0[0-9]{9,10}$/;
const UK_INTL = /^\+44[0-9]{9,10}$/;
const INTL = /^\+[1-9][0-9]{7,14}$/;
const POSTCODE = /^[A-Za-z]{1,2}[0-9][A-Za-z0-9]?[0-9][A-Za-z]{2}$/;

const fail = (message: string): ValidationResult => ({ ok: false, message });
const pass = (value: string | null): ValidationResult => ({ ok: true, value });

/** Trim, then blank, length (code points) and control characters, in that order; first failure wins. */
function cleanText(raw: string | null | undefined, requiredMessage: string | null, max: number): ValidationResult {
  const value = trimSpaces(raw ?? "");
  if (value === "") return requiredMessage === null ? pass(null) : fail(requiredMessage);
  if (codePointLength(value) > max) return fail(`Use ${max} characters or fewer.`);
  if (containsForbiddenCharacter(value)) return fail(MSG_CONTROL);
  return pass(value);
}

export const validateName = (raw: string | null) => cleanText(raw, MSG_NAME, NAME_MAX);
export const validateContactName = (raw: string | null) => cleanText(raw, null, CONTACT_NAME_MAX);
export const validateLine1 = (raw: string | null) => cleanText(raw, MSG_LINE1, LINE_MAX);
export const validateLine2 = (raw: string | null) => cleanText(raw, null, LINE_MAX);
export const validateTown = (raw: string | null) => cleanText(raw, MSG_TOWN, TOWN_MAX);
export const validateCounty = (raw: string | null) => cleanText(raw, null, COUNTY_MAX);

export function validateEmail(raw: string | null): ValidationResult {
  const r = cleanText(raw, null, EMAIL_MAX);
  if (!r.ok || r.value === null) return r;
  return EMAIL.test(r.value) ? r : fail(MSG_EMAIL);
}

/** The number without spaces, hyphens, brackets and a `(0)` right after `+44`. */
export function phoneDigits(value: string): string {
  let squashed = value.replace(/ /g, "").replace(/-/g, "");
  if (squashed.startsWith("+44(0)")) squashed = "+44" + squashed.slice("+44(0)".length);
  return squashed.replace(/[()]/g, "");
}

/** Runs of spaces collapse to one space (the value is already trimmed). */
export function normalisePhone(value: string): string {
  return value.replace(/ {2,}/g, " ");
}

export function validatePhone(raw: string | null): ValidationResult {
  const r = cleanText(raw, null, PHONE_MAX);
  if (!r.ok || r.value === null) return r;
  if (!PHONE_CHARS.test(r.value)) return fail(MSG_PHONE);
  const digits = phoneDigits(r.value);
  if (!(UK_LOCAL.test(digits) || UK_INTL.test(digits) || INTL.test(digits))) return fail(MSG_PHONE);
  return pass(normalisePhone(r.value));
}

/** `bs65qa` -> `BS6 5QA`: upper case, inward code (the last three characters) after a space. */
export function normalisePostcode(compact: string): string {
  const upper = compact.toUpperCase();
  return `${upper.slice(0, -3)} ${upper.slice(-3)}`;
}

export function validatePostcode(raw: string | null): ValidationResult {
  const value = trimSpaces(raw ?? "");
  if (value === "" || codePointLength(value) > POSTCODE_RAW_MAX || containsForbiddenCharacter(value)) {
    return fail(MSG_POSTCODE);
  }
  const compact = value.replace(/ /g, "");
  return POSTCODE.test(compact) ? pass(normalisePostcode(compact)) : fail(MSG_POSTCODE);
}

export const VALIDATORS: Record<CustomerField, (raw: string | null) => ValidationResult> = {
  name: validateName,
  contact_name: validateContactName,
  email: validateEmail,
  phone: validatePhone,
  line1: validateLine1,
  line2: validateLine2,
  town: validateTown,
  county: validateCounty,
  postcode: validatePostcode,
};

/** Length in code points of the trimmed text, for the "12 / 120" counters. */
export function trimmedLength(raw: string): number {
  return codePointLength(trimSpaces(raw));
}

export const FIELD_MAX: Partial<Record<CustomerField, number>> = {
  name: NAME_MAX,
  contact_name: CONTACT_NAME_MAX,
  email: EMAIL_MAX,
  phone: PHONE_MAX,
  line1: LINE_MAX,
  line2: LINE_MAX,
  town: TOWN_MAX,
  county: COUNTY_MAX,
};
