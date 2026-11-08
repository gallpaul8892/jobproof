import { Link, useLocation } from "react-router";
import {
  customerTypeLabel,
  formatAddress,
  formatDate,
  formatTime,
  useReports,
  type CustomerRecord,
} from "@jobproof/shared";
import { EmptyState, ErrorState, Loading } from "../../components/QueryBoundary";
import { ReviewBadge, TableWrap } from "../../components/ui";
import type { ReactNode } from "react";

function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="kv-row">
      <dt>{label}</dt>
      <dd data-testid={testId}>{children}</dd>
    </div>
  );
}

/** The saved details, read-only. Everything is rendered as text. */
export function CustomerDetails({ customer }: { customer: CustomerRecord }) {
  return (
    <section className="panel" aria-labelledby="customer-details-heading" data-testid="customer-details">
      <h2 id="customer-details-heading">Details</h2>
      <dl className="kv">
        <Row label="Name" testId="customer-name">
          {customer.name}
        </Row>
        <Row label="Type">{customerTypeLabel(customer.customer_type)}</Row>
        <Row label="Contact" testId="customer-contact">
          {customer.contact_name ?? "-"}
        </Row>
        <Row label="Email" testId="customer-email">
          {customer.email ?? "-"}
        </Row>
        <Row label="Phone" testId="customer-phone">
          {customer.phone ?? "-"}
        </Row>
        <Row label="Billing address" testId="customer-address">
          {formatAddress(customer.billing_address)}
        </Row>
        <Row label="Last changed" testId="customer-last-changed">
          {customer.last_changed_by && customer.last_changed_at
            ? `${customer.last_changed_by.name}, ${formatDate(customer.last_changed_at)} at ${formatTime(customer.last_changed_at)}`
            : "Not changed since it was created"}
        </Row>
      </dl>
    </section>
  );
}

/** The customer's reports, newest first (the list's own order). */
export function CustomerReports({ customerId }: { customerId: string }) {
  const location = useLocation();
  const query = useReports({ page: 1, customer_id: customerId }, 100);
  return (
    <section className="panel" aria-labelledby="customer-reports-heading" data-testid="customer-reports">
      <h2 id="customer-reports-heading">Reports for this customer</h2>
      {query.data === undefined ? (
        query.isError ? (
          <ErrorState what="this customer's reports" error={query.error} onRetry={() => void query.refetch()} busy={query.isFetching} />
        ) : (
          <Loading what="reports" rows={3} />
        )
      ) : query.data.items.length === 0 ? (
        <EmptyState title="No reports yet" />
      ) : (
        <>
          <p className="result-count" data-testid="customer-report-count">
            {query.data.total} {query.data.total === 1 ? "report" : "reports"}
          </p>
          <TableWrap label="Reports for this customer">
            <table className="table table-compact" data-testid="customer-reports-table">
              <thead>
                <tr>
                  <th scope="col">Job ref</th>
                  <th scope="col" className="col-wide">
                    Completed
                  </th>
                  <th scope="col">Review</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((r) => (
                  <tr key={r.id} data-testid="customer-report-row">
                    <td className="nowrap">
                      <Link to={`/reports/${r.id}`} state={{ from: location.pathname }} className="strong">
                        {r.job_reference}
                      </Link>
                      <span className="stack-only">{formatDate(r.completed_on)}</span>
                    </td>
                    <td className="nowrap col-wide">{formatDate(r.completed_on)}</td>
                    <td>
                      <ReviewBadge status={r.review_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {query.data.total > query.data.items.length && (
            <p className="muted small">
              Showing the latest {query.data.items.length} of {query.data.total} reports.
            </p>
          )}
        </>
      )}
    </section>
  );
}
