import { Link } from "react-router";
import { formatAddressShort, formatDateTime, waitingLabel, type ReportSummary } from "@jobproof/shared";
import { TableWrap } from "../../components/ui";

/**
 * The next reports to review, oldest first (at most five, from the dashboard response).
 * `awaitingCount` is the total waiting, which can be more than the rows shown.
 */
export function ReviewQueue({
  items,
  awaitingCount,
  asOf,
}: {
  items: ReportSummary[];
  awaitingCount: number;
  asOf: string;
}) {
  return (
    <section className="panel review-queue" aria-labelledby="queue-heading" data-testid="review-queue">
      <div className="panel-head">
        <h2 id="queue-heading">Review queue</h2>
        {items.length > 0 && <span className="muted small">Longest waiting first</span>}
      </div>
      {items.length === 0 ? (
        <p className="queue-empty" data-testid="queue-empty">
          Nothing is waiting for review.
        </p>
      ) : (
        <TableWrap label="Review queue">
          <table className="table" data-testid="review-queue-table">
            <thead>
              <tr>
                <th scope="col">Job ref</th>
                <th scope="col">Customer</th>
                <th scope="col" className="col-wide">
                  Site
                </th>
                <th scope="col" className="col-wide">
                  Painter
                </th>
                <th scope="col" className="col-wide">
                  Submitted
                </th>
                <th scope="col" className="col-wide">
                  Waiting
                </th>
                <th scope="col">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const waiting = waitingLabel(r.submitted_at, asOf);
                const site = formatAddressShort(r.site_address);
                return (
                  <tr key={r.id} data-testid="queue-row">
                    <td className="nowrap">
                      <Link to={`/reports/${r.id}`} className="strong" data-testid="queue-ref">
                        {r.job_reference}
                      </Link>
                      <span className="stack-only">{waiting}</span>
                    </td>
                    <td>
                      {r.customer.name}
                      <span className="stack-only">{r.painter.name}</span>
                      <span className="stack-only">Submitted {formatDateTime(r.submitted_at)}</span>
                    </td>
                    <td className="truncate col-wide" title={site}>
                      {site}
                    </td>
                    <td className="col-wide">{r.painter.name}</td>
                    <td className="nowrap col-wide">{formatDateTime(r.submitted_at)}</td>
                    <td className="nowrap col-wide" data-testid="queue-waiting">
                      {waiting}
                    </td>
                    <td className="num">
                      <Link
                        to={`/reports/${r.id}`}
                        className="btn btn-small"
                        aria-label={`Review ${r.job_reference}`}
                        data-testid="queue-review"
                      >
                        Review
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
      {awaitingCount > 0 && (
        <p className="queue-footer">
          <Link to="/reports?review_status=awaiting_review&sort=submitted_asc" data-testid="queue-view-all">
            View all {awaitingCount} awaiting review
          </Link>
        </p>
      )}
    </section>
  );
}
