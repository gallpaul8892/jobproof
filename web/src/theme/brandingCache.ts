import type { Branding } from "@jobproof/shared";
import { parseBrandingSnapshot } from "@jobproof/shared";

// One snapshot per origin, which is one per deployment (decision D1), so it can only ever hold
// this company's name. Every access is guarded: private mode and quota errors must not matter.
export const BRANDING_KEY = "jobproof.branding.v1";

export const parseSnapshot = parseBrandingSnapshot;

export function readSnapshot(): Branding | undefined {
  try {
    const raw = window.localStorage.getItem(BRANDING_KEY);
    const snapshot = parseSnapshot(raw);
    if (raw !== null && snapshot === undefined) window.localStorage.removeItem(BRANDING_KEY);
    return snapshot;
  } catch {
    return undefined;
  }
}

export function writeSnapshot(branding: Branding): void {
  try {
    window.localStorage.setItem(BRANDING_KEY, JSON.stringify(branding));
  } catch {
    /* storage unavailable: the app works without a snapshot */
  }
}
