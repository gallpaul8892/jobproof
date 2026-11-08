import { useState } from "react";
import {
  describeEvent,
  formatDateTime,
  truncate,
  useReportHistory,
  type AuditEvent,
  type DescribedChange,
} from "@jobproof/shared";
import { ErrorState, Loading } from "../../components/QueryBoundary";

const HISTORY_LIMIT = 100;

function ChangeRow({ change }: { change: DescribedChange }) {
  const [open, setOpen] = useState(false);
  const before = truncate(change.old);
  const after = truncate(change.new);
  const cut = before.isTruncated || after.isTruncated;
  return (
    <li className="history-change" data-testid="history-change">
      <span className="history-field">{change.label}</span>
      <div className="history-values">
        <div>
          <span className="history-tag">Before</span>
          <span className="history-text" data-testid="history-before">
            {open ? change.old : before.short}
          </span>
        </div>
        <div>
          <span className="history-tag">After</span>
          <span className="history-text" data-testid="history-after">
            {open ? change.new : after.short}
          </span>
        </div>
      </div>
      {cut && (
        <button
          type="button"
          className="btn btn-small"
          aria-expanded={open}
          data-testid="history-toggle"
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide full change" : "Show full change"}
        </button>
      )}
    </li>
  );
}

function EventRow({ event }: { event: AuditEvent }) {
  const described = describeEvent(event);
  return (
    <li className="history-event" data-testid="history-event">
      <time dateTime={event.occurred_at} className="history-time">
        {formatDateTime(event.occurred_at)}
      </time>
      <div>
        <p className="history-sentence" data-testid="history-sentence">
          {described.sentence}
        </p>
        {described.changes.length > 0 && (
          <ul className="history-changes">
            {described.changes.map((c, i) => (
              <ChangeRow key={i} change={c} />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/** Newest first. Has its own query, so a failure here leaves the rest of the report untouched. */
export function HistoryPanel({ reportId }: { reportId: string }) {
  const query = useReportHistory(reportId);
  const data = query.data;
  return (
    <section className="panel panel-wide" aria-labelledby="history-heading" data-testid="history">
      <h2 id="history-heading">History</h2>
      {data === undefined ? (
        query.isError ? (
          <ErrorState what="the history" error={query.error} onRetry={() => void query.refetch()} busy={query.isFetching} />
        ) : (
          <Loading what="the history" rows={2} />
        )
      ) : data.items.length === 0 ? (
        <p className="muted" data-testid="history-empty">
          No changes recorded yet.
        </p>
      ) : (
        <>
          <ol className="history-list">
            {data.items.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </ol>
          {data.total > HISTORY_LIMIT && (
            <p className="muted small" data-testid="history-more">
              Showing the latest {HISTORY_LIMIT} of {data.total} changes.
            </p>
          )}
        </>
      )}
    </section>
  );
}
