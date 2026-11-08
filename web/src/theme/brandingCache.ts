import type { Branding } from "@jobproof/shared";
import { COMPANY_NAME_MAX } from "@jobproof/shared";

// One snapshot per origin, which is one per deployment (decision D1), so it can only ever hold
// this company's name. Every access is guarded: private mode and quota errors must not matter.
export const BRANDING_KEY = "jobproof.branding.v1";

const HEX = /^#[0-9A-F]{6}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const COLOURS = ["primary", "accent", "background", "surface", "text"] as const;

export function parseSnapshot(raw: string | null): Branding | undefined {
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return undefined;
    const {
      company_name: name,
      theme,
      uk_only_contact_details: ukOnly,
    } = value as { company_name?: unknown; theme?: unknown; uk_only_contact_details?: unknown };
    if (typeof name !== "string" || name.length === 0 || Array.from(name).length > COMPANY_NAME_MAX || CONTROL.test(name)) {
      return undefined;
    }
    if (typeof theme !== "object" || theme === null) return undefined;
    const t = theme as Record<string, unknown>;
    if (!COLOURS.every((c) => typeof t[c] === "string" && HEX.test(t[c] as string))) return undefined;
    return {
      company_name: name,
      theme: {
        primary: t.primary as string,
        accent: t.accent as string,
        background: t.background as string,
        surface: t.surface as string,
        text: t.text as string,
      },
      // A snapshot saved before T-002p has no flag: the strict default until the next fetch.
      uk_only_contact_details: ukOnly !== false,
    };
  } catch {
    return undefined;
  }
}

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
