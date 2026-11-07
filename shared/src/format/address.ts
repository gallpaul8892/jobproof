import type { Address } from "../generated";

/** Every non-empty line, joined: "Flat 14, The Old Chapel, Bristol, City of Bristol, BS2 8DT". */
export function formatAddress(a: Address): string {
  return [a.line1, a.line2, a.town, a.county, a.postcode].filter(Boolean).join(", ");
}

/** "line1, town, postcode" for tables. */
export function formatAddressShort(a: Address): string {
  return [a.line1, a.town, a.postcode].filter(Boolean).join(", ");
}
