import { Link } from "react-router";
import {
  formatAddressShort,
  formatDateTime,
  formatMonth,
  formatPence,
  useDashboard,
  type Dashboard,
} from "@jobproof/shared";
import { EmptyState, QueryBoundary } from "../components/QueryBoundary";
import { BillingBadge, PageHeader, ReviewBadge, TableWrap, useDocumentTitle } from "../components/ui";

function Stat({
  testId,
  label,
  value,
  to,
  hint,
}: {
  testId: string;
  label: string;
  value: string;
  to?: string;
  hint?: string;
}) {
  const body = (
    <>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </>
  );
  return to ? (
    <Link to={to} className="stat stat-link" data-testid={testId}>
      {body}
    </Link>
  ) : (
    <div className="stat" data-testid={testId}>
      {body}
    </div>
  );
}

function DashboardView({ d }: { d: Dashboard }) {
  return (
    <>
      <div className="stats">
        <Stat
          testId="stat-awaiting-review"
          label="Reports awaiting review"
          value={String(d.reports_awaiting_review)}
          to="/reports?review_status=awaiting_review"
          hint="View them"
        />
        <Stat
          testId="stat-completed-month"
          label="Jobs completed this month"
          value={String(d.jobs_completed_this_month)}
        />
        <Stat
          testId="stat-invoiced-month"
          label="Invoiced this month"
          value={formatPence(d.invoiced_this_month_pence)}
        />
        <Stat
          testId="stat-outstanding"
          label="Outstanding"
          value={formatPence(d.outstanding_pence)}
          to="/billing"
          hint="Unpaid balance"
        />
        <Stat
          testId="stat-overdue"
          label="Overdue invoices"
          value={String(d.overdue_invoice_count)}
          to="/billing?status=overdue"
          hint="View them"
        />
      </div>

      <section className="panel" aria-labelledby="recent-heading">
        <div className="panel-head">
          <h2 id="recent-heading">Recent reports</h2>
          <Link to="/reports">View all reports</Link>
        </div>
        {d.recent_reports.length === 0 ? (
          <EmptyState title="No reports yet">
            <p className="muted">Reports appear here when painters submit them.</p>
          </EmptyState>
        ) : (
          <TableWrap label="Recent reports">
            <table className="table" data-testid="recent-reports-table">
              <thead>
                <tr>
                  <th scope="col">Job ref</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Site</th>
                  <th scope="col">Painter</th>
                  <th scope="col">Submitted</th>
                  <th scope="col">Review</th>
                  <th scope="col">Billing</th>
                </tr>
              </thead>
              <tbody>
                {d.recent_reports.map((r) => (
                  <tr key={r.id} data-testid="recent-report-row">
                    <td className="nowrap">
                      <Link to={`/reports/${r.id}`} className="strong">
                        {r.job_reference}
                      </Link>
                    </td>
                    <td>{r.customer.name}</td>
                    <td className="truncate" title={formatAddressShort(r.site_address)}>
                      {formatAddressShort(r.site_address)}
                    </td>
                    <td>{r.painter.name}</td>
                    <td className="nowrap">{formatDateTime(r.submitted_at)}</td>
                    <td>
                      <ReviewBadge status={r.review_status} />
                    </td>
                    <td>
                      <BillingBadge status={r.billing_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>
    </>
  );
}

export function DashboardPage() {
  useDocumentTitle("Dashboard");
  const query = useDashboard();
  return (
    <>
      <PageHeader title="Dashboard">
        {query.data ? (
          <>
            Figures for <span data-testid="period-label">{formatMonth(query.data.period_start)}</span>
          </>
        ) : (
          "Where the business stands today"
        )}
      </PageHeader>
      <QueryBoundary query={query} what="the dashboard" skeletonRows={4}>
        {(d) => <DashboardView d={d} />}
      </QueryBoundary>
    </>
  );
}
