import Storage from "expo-sqlite/kv-store";
import { parseBrandingSnapshot, type Branding } from "@jobproof/shared";

// Last known branding, so the company name and colours show with no signal (T-003a scenario 4).
export const BRANDING_KEY = "jobproof.branding.v1";

export function readBrandingSnapshot(): Branding | undefined {
  try {
    const raw = Storage.getItemSync(BRANDING_KEY);
    const snapshot = parseBrandingSnapshot(raw);
    if (raw !== null && snapshot === undefined) Storage.removeItemSync(BRANDING_KEY);
    return snapshot;
  } catch {
    return undefined;
  }
}

export function writeBrandingSnapshot(branding: Branding): void {
  try {
    Storage.setItemSync(BRANDING_KEY, JSON.stringify(branding));
  } catch {
    /* storage unavailable: the app works without a snapshot */
  }
}
