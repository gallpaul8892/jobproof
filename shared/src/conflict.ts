import { ApiError } from "./api/errors";
import type { PersonRef, ReportEditableValues } from "./generated";

export interface Conflict {
  /** "already_reviewed": someone reviewed it. "stale": the report changed since it was loaded. */
  kind: "already_reviewed" | "stale";
  currentVersion?: number;
  reviewedBy?: PersonRef;
  reviewedAt?: string;
  lastChangedBy?: PersonRef;
  lastChangedAt?: string;
  /** PATCH only: the current values of the fields that were sent. */
  current?: ReportEditableValues;
}

function person(v: unknown): PersonRef | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const r = v as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.name === "string" ? { id: r.id, name: r.name } : undefined;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/**
 * Reads a 409 from the review or edit endpoints. `already_reviewed`, or a `version_conflict` whose
 * latest change was the review itself, is "already_reviewed"; any other `version_conflict` is
 * "stale". Anything that is not one of those two 409s returns null.
 */
export function parseConflict(error: unknown): Conflict | null {
  if (!(error instanceof ApiError) || error.status !== 409 || !error.problem) return null;
  const p = error.problem;
  const base = {
    currentVersion: typeof p.current_version === "number" ? p.current_version : undefined,
    reviewedBy: person(p.reviewed_by),
    reviewedAt: str(p.reviewed_at),
    lastChangedBy: person(p.last_changed_by),
    lastChangedAt: str(p.last_changed_at),
    current:
      typeof p.current === "object" && p.current !== null ? (p.current as ReportEditableValues) : undefined,
  };
  if (error.code === "already_reviewed") return { kind: "already_reviewed", ...base };
  if (error.code === "version_conflict") {
    const reviewedLast =
      p.review_status === "reviewed" && base.reviewedAt !== undefined && base.reviewedAt === base.lastChangedAt;
    return { kind: reviewedLast ? "already_reviewed" : "stale", ...base };
  }
  return null;
}
