import { useRef, useState } from "react";
import {
  ApiError,
  formatDateTime,
  formatTime,
  parseConflict,
  useMe,
  useRefreshReport,
  useReviewReport,
  type ReportDetail,
} from "@jobproof/shared";

type Note =
  | { kind: "done"; text: string }
  | { kind: "already"; text: string }
  | { kind: "stale" }
  | { kind: "error"; text: string };

/**
 * The review state of a report and the "Mark as reviewed" button, with the cases where another
 * manager got there first, the report changed, or the request failed.
 */
export function ReviewPanel({ report, editing }: { report: ReportDetail; editing: boolean }) {
  const mutation = useReviewReport(report.id);
  const refresh = useRefreshReport(report.id);
  const me = useMe();
  const [note, setNote] = useState<Note | null>(null);
  const [reloading, setReloading] = useState(false);
  // Set synchronously in the click handler so a double click sends one request.
  const inFlight = useRef(false);

  function review() {
    if (inFlight.current || mutation.isPending) return;
    inFlight.current = true;
    setNote(null);
    mutation.mutate(report.version, {
      onSuccess: () => setNote({ kind: "done", text: "Marked as reviewed" }),
      onError: (error) => {
        const conflict = parseConflict(error);
        if (conflict?.kind === "already_reviewed") {
          void refresh();
          // Our own earlier request had succeeded (for example the reply was lost): no complaint.
          if (conflict.reviewedBy?.id !== undefined && conflict.reviewedBy.id === me.data?.id) {
            setNote({ kind: "done", text: "Marked as reviewed" });
          } else {
            const who = conflict.reviewedBy?.name ?? "Another manager";
            const when = conflict.reviewedAt ? ` at ${formatTime(conflict.reviewedAt)}` : "";
            setNote({ kind: "already", text: `${who} already reviewed this report${when}.` });
          }
        } else if (conflict?.kind === "stale") {
          setNote({ kind: "stale" });
        } else {
          const forbidden = error instanceof ApiError && error.status === 403;
          setNote({
            kind: "error",
            text: forbidden
              ? "You do not have permission to review this report."
              : "Could not mark as reviewed. Try again.",
          });
        }
      },
      onSettled: () => {
        inFlight.current = false;
      },
    });
  }

  async function reload() {
    setReloading(true);
    try {
      await refresh();
      setNote(null);
    } finally {
      setReloading(false);
    }
  }

  const reviewed = report.review_status === "reviewed";
  const live = note && note.kind !== "stale" && note.kind !== "error" ? note.text : "";

  return (
    <div className="review-panel" data-testid="review-panel">
      {reviewed && report.reviewed_at ? (
        <p className="review-line" data-testid="review-line">
          Reviewed by {report.reviewed_by?.name ?? "a manager"} on {formatDateTime(report.reviewed_at)}
        </p>
      ) : (
        <p className="review-line" data-testid="review-line">
          Awaiting review
        </p>
      )}

      {/* Always present, so a screen reader announces text put into it. */}
      <p role="status" className={live ? "review-note" : "sr-only"} data-testid="review-status">
        {live}
      </p>

      {note?.kind === "stale" && (
        <div className="notice" data-testid="review-stale">
          <p>This report changed while you were looking at it. Reload to see the latest version before reviewing.</p>
          <button type="button" className="btn btn-small" onClick={() => void reload()} disabled={reloading}>
            {reloading ? "Reloading..." : "Reload report"}
          </button>
        </div>
      )}
      {note?.kind === "error" && (
        <p role="alert" className="alert" data-testid="review-error">
          {note.text}
        </p>
      )}

      {!reviewed && note?.kind !== "stale" && (
        <>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="mark-reviewed"
            onClick={review}
            disabled={mutation.isPending || editing}
            aria-busy={mutation.isPending}
            aria-describedby={editing ? "review-editing-hint" : undefined}
          >
            {mutation.isPending ? "Marking as reviewed..." : "Mark as reviewed"}
          </button>
          {editing && (
            <p id="review-editing-hint" className="muted small">
              Save or cancel your edits before reviewing.
            </p>
          )}
        </>
      )}
    </div>
  );
}
