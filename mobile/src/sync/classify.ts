import { ApiError } from "@jobproof/shared";

/**
 * What the sync engine does about a failed request (design 3.4, "Error classification"). Pure:
 * the table below is the whole policy, unit-tested row by row, including the rows later tickets
 * (photos, submit) will use.
 */
export type Verdict =
  /** Network error, timeout, 5xx, 429 or 503 `busy`: try again with backoff. */
  | { kind: "retry"; offline: boolean; retryAfterSeconds?: number }
  /** 401 that the refresh could not fix: queue kept, "Please sign in again to finish sending". */
  | { kind: "session_ended"; code: string }
  /** 426: pause everything. */
  | { kind: "update_required" }
  /** Stop for this job until the operative acts or taps Sync now; nothing is deleted. */
  | { kind: "needs_attention"; code: string; message: string }
  /** 409 `already_submitted`: compare `submission_id` from a fresh GET. */
  | { kind: "check_submission" }
  /** 409 `photos_not_registered`: register these ids, then retry the submit. */
  | { kind: "register_missing"; photoIds: string[] }
  /** 409 `report_submitted`: a change after submission is not sent. */
  | { kind: "report_submitted"; message: string }
  /** A photo that cannot be sent as it is (409 `photo_content_mismatch`, 413, 415). */
  | { kind: "photo_failed"; code: string; message: string }
  /** 409 `duplicate_photo`: the operative may delete it. */
  | { kind: "duplicate_photo"; message: string }
  /** 422 `checksum_mismatch`: recompute from the file, retry at most 3 times. */
  | { kind: "retry_checksum" }
  /** 422 `submission_incomplete`: the draft goes back to `draft` with the server's reasons. */
  | { kind: "back_to_draft"; reasons: string[] };

export const VERDICT_MSG = {
  jobChanged: "This job was changed by the office. Contact the office.",
  cancelled: "The office cancelled this job. Contact the office.",
  closed: "The office has already closed this job.",
  ownedByOther: "Another operative started this job's report. Contact the office.",
  photoLimit: "This report has the maximum 60 photos.",
  reportSubmitted: "Not sent: report already submitted",
  duplicate: "This photo is already on this job.",
  tooLarge: "Couldn't be sent: file too large",
  notAPhoto: "Couldn't be sent: not a photo",
  mismatch: "Couldn't be sent: the file changed. Contact the office.",
  refused: "The office system refused this. Contact the office.",
} as const;

export function classify(error: unknown): Verdict {
  // Not an ApiError: the client itself failed (a bug), which must not pose as a signal problem.
  if (!(error instanceof ApiError)) return { kind: "retry", offline: false };
  const { status, code } = error;
  const retryAfter = error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {};

  if (status === 0) return { kind: "retry", offline: true };
  if (status === 429 || status >= 500) return { kind: "retry", offline: false, ...retryAfter };
  if (status === 401) return { kind: "session_ended", code: code === "account_inactive" ? "account_inactive" : "session_ended" };
  if (status === 426) return { kind: "update_required" };
  if (status === 404) return { kind: "needs_attention", code: "job_changed", message: VERDICT_MSG.jobChanged };
  if (status === 403) return { kind: "needs_attention", code: "forbidden", message: VERDICT_MSG.refused };
  if (status === 413) return { kind: "photo_failed", code: "photo_too_large", message: VERDICT_MSG.tooLarge };
  if (status === 415) return { kind: "photo_failed", code: "unsupported_photo_type", message: VERDICT_MSG.notAPhoto };

  if (status === 409) {
    switch (code) {
      case "job_cancelled":
        return { kind: "needs_attention", code, message: VERDICT_MSG.cancelled };
      case "job_closed":
        return { kind: "needs_attention", code, message: VERDICT_MSG.closed };
      case "draft_owned_by_other":
        return { kind: "needs_attention", code, message: VERDICT_MSG.ownedByOther };
      case "photo_limit_reached":
        return { kind: "needs_attention", code, message: VERDICT_MSG.photoLimit };
      case "already_submitted":
        return { kind: "check_submission" };
      case "photos_not_registered": {
        const ids = error.problem?.missing_photo_ids;
        return { kind: "register_missing", photoIds: Array.isArray(ids) ? ids.filter((i): i is string => typeof i === "string") : [] };
      }
      case "report_submitted":
        return { kind: "report_submitted", message: VERDICT_MSG.reportSubmitted };
      case "photo_content_mismatch":
        return { kind: "photo_failed", code, message: VERDICT_MSG.mismatch };
      case "duplicate_photo":
        return { kind: "duplicate_photo", message: VERDICT_MSG.duplicate };
      default:
        return { kind: "needs_attention", code: code || "conflict", message: VERDICT_MSG.refused };
    }
  }

  if (status === 422) {
    if (code === "checksum_mismatch") return { kind: "retry_checksum" };
    if (code === "submission_incomplete") return { kind: "back_to_draft", reasons: error.fieldErrors.map((e) => e.message).filter((m) => m !== "") };
    return { kind: "needs_attention", code: code || "validation_error", message: VERDICT_MSG.refused };
  }

  // Any other 4xx: the server will not take this as it is; keep the work and say so.
  return { kind: "needs_attention", code: code || `http_${status}`, message: VERDICT_MSG.refused };
}
