import { formatAddress, type Address } from "@jobproof/shared";

/**
 * `tel:` with the number tidied to digits (and a leading +). On Android `Linking.openURL` hands
 * this to the dialler with the number filled in; it does not dial and needs no CALL_PHONE
 * permission (design: the permission allowlist has none). Null when nothing dialable remains.
 */
export function telUrl(phone: string): string | null {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 0) return null;
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}

/** `geo:0,0?q=<address>` lets Android offer whichever maps apps are installed; the app has no map. */
export function mapsUrl(address: Address): string {
  return `geo:0,0?q=${encodeURIComponent(formatAddress(address))}`;
}

/** Notes shorter than this and with few line breaks never need "Show more" (6 lines at normal text size). */
export const NOTES_COLLAPSED_LINES = 6;
export function notesNeedToggle(notes: string): boolean {
  return notes.length > 200 || notes.split("\n").length > NOTES_COLLAPSED_LINES;
}
