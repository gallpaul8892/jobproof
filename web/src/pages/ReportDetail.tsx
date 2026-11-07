import type { ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router";
import {
  customerTypeLabel,
  formatAddress,
  formatDate,
  formatDateTime,
  formatPence,
  jobStatusLabel,
  jobTypeLabel,
  paymentKindLabel,
  paymentMethodLabel,
  quoteStatusLabel,
  useReport,
  type ReportDetail,
} from "@jobproof/shared";
import { ApiError } from "@jobproof/shared";
import { useThrottledRefetch } from "../components/useThrottledRefetch";
import { PhotoGallery } from "../components/PhotoGallery";
import { QueryBoundary } from "../components/QueryBoundary";
import { BillingBadge, PageHeader, ReviewBadge, TableWrap, useDocumentTitle } from "../components/ui";

function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="kv-row">
      <dt>{label}</dt>
      <dd data-testid={testId}>{children}</dd>
    </div>
  );
}

function Section({ title, id, children, wide }: { title: string; id: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`panel${wide ? " panel-wide" : ""}`} aria-labelledby={id} data-testid={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

function Detail({ r, onImageError, version }: { r: ReportDetail; onImageError: () => void; version: number }) {
  const { job, customer, quote, invoice } = r;
  return (
    <div className="detail-grid">
      <Section title="Job details" id="job-details">
        <dl className="kv">
          <Row label="Type">{jobTypeLabel(job.job_type)}</Row>
          <Row label="Status">{jobStatusLabel(job.status)}</Row>
          <Row label="Scheduled start">{formatDate(job.scheduled_start)}</Row>
          <Row label="Completed">{job.completed_on ? formatDate(job.completed_on) : "Not completed"}</Row>
          <Row label="Site address" testId="site-address">
            {formatAddress(job.site_address)}
          </Row>
          <Row label="Notes">
            {job.notes ? <span className="prewrap">{job.notes}</span> : <span className="muted">No notes</span>}
          </Row>
        </dl>
      </Section>

      <Section title="Customer" id="customer">
        <dl className="kv">
          <Row label="Name">{customer.name}</Row>
          <Row label="Type">{customerTypeLabel(customer.customer_type)}</Row>
          {customer.contact_name && <Row label="Contact">{customer.contact_name}</Row>}
          <Row label="Email">{customer.email ?? "-"}</Row>
          <Row label="Phone">{customer.phone ?? "-"}</Row>
          <Row label="Billing address">{formatAddress(customer.billing_address)}</Row>
          <Row label="History">
            {customer.job_count} {customer.job_count === 1 ? "job" : "jobs"} with us
          </Row>
        </dl>
      </Section>

      <Section title="Painter" id="painter">
        <dl className="kv">
          <Row label="Painter">{r.painter.name}</Row>
          <Row label="Submitted">{formatDateTime(r.submitted_at)}</Row>
          <Row label="Review">
            {r.review_status === "reviewed" && r.reviewed_at ? (
              <>
                Reviewed by {r.reviewed_by?.name ?? "a manager"}, {formatDateTime(r.reviewed_at)}
              </>
            ) : (
              "Awaiting review"
            )}
          </Row>
        </dl>
        <h3>Painter notes</h3>
        {r.painter_notes ? (
          <p className="prewrap" data-testid="painter-notes">
            {r.painter_notes}
          </p>
        ) : (
          <p className="muted">The painter left no notes.</p>
        )}
      </Section>

      <Section title="Checklist" id="checklist">
        {r.checklist.length === 0 ? (
          <p className="muted">No checklist was submitted.</p>
        ) : (
          <ul className="checklist">
            {r.checklist.map((item) => (
              <li key={item.id} className={item.done ? "" : "check-open"}>
                <span className={`check-mark ${item.done ? "check-done" : "check-todo"}`} aria-hidden="true">
                  {item.done ? "✓" : "!"}
                </span>
                <div>
                  <span>
                    {item.label}
                    <span className="sr-only">{item.done ? " (done)" : ""}</span>
                  </span>
                  {!item.done && <span className="tag-open">Not done</span>}
                  {item.note && <p className="muted small">{item.note}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Photos" id="photos" wide>
        <PhotoGallery photos={r.photos} onImageError={onImageError} version={version} />
      </Section>

      <Section title="Billing" id="billing" wide>
        <div className="billing-grid">
          <div>
            <h3>Quote</h3>
            {quote ? (
              <dl className="kv">
                <Row label="Reference">
                  {quote.reference} <span className="muted">({quoteStatusLabel(quote.status)})</span>
                </Row>
                <Row label="Issued">{formatDate(quote.issued_on)}</Row>
                <Row label="Total">{formatPence(quote.total_pence)}</Row>
                <Row label="Deposit requested">
                  {quote.deposit_pence > 0 ? formatPence(quote.deposit_pence) : "No deposit requested"}
                </Row>
                {quote.deposit_pence > 0 && (
                  <Row label="Deposit paid">{formatPence(quote.deposit_paid_pence)}</Row>
                )}
              </dl>
            ) : (
              <p className="muted">No quote</p>
            )}
          </div>
          <div>
            <h3>Invoice</h3>
            {invoice ? (
              <dl className="kv" data-testid="invoice-summary">
                <Row label="Number">{invoice.number}</Row>
                <Row label="Status">
                  <BillingBadge status={invoice.status} />
                </Row>
                <Row label="Subtotal">{formatPence(invoice.subtotal_pence)}</Row>
                <Row label="VAT (20%)">{formatPence(invoice.vat_pence)}</Row>
                <Row label="Deposit applied">{formatPence(invoice.deposit_applied_pence)}</Row>
                <Row label="Total">
                  <strong>{formatPence(invoice.total_pence)}</strong>
                </Row>
                <Row label="Paid">{formatPence(invoice.paid_pence)}</Row>
                <Row label="Balance">{formatPence(invoice.balance_pence)}</Row>
                <Row label="Issued">{invoice.issue_date ? formatDate(invoice.issue_date) : "-"}</Row>
                <Row label="Due">{invoice.due_date ? formatDate(invoice.due_date) : "-"}</Row>
              </dl>
            ) : (
              <p className="muted">Not invoiced yet</p>
            )}
          </div>
        </div>
        <h3>Payments</h3>
        {r.payments.length === 0 ? (
          <p className="muted">No payments recorded.</p>
        ) : (
          <TableWrap label="Payments">
            <table className="table table-compact" data-testid="payments-table">
              <thead>
                <tr>
                  <th scope="col">Received</th>
                  <th scope="col">For</th>
                  <th scope="col">Method</th>
                  <th scope="col" className="num">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="nowrap">{formatDateTime(p.received_at)}</td>
                    <td>{paymentKindLabel(p.kind)}</td>
                    <td>{paymentMethodLabel(p.method)}</td>
                    <td className="num">{formatPence(p.amount_pence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}

export function ReportDetailPage() {
  const { reportId = "" } = useParams();
  const location = useLocation();
  const listSearch = (location.state as { listSearch?: string } | null)?.listSearch ?? "";
  const query = useReport(reportId);
  const data = query.data;
  // Signed photo URLs expire; a failed image refetches the report once a minute at most.
  const refreshPhotoUrls = useThrottledRefetch(query.refetch);
  useDocumentTitle(data ? data.job.reference : "Report");

  const notFound = query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 422);
  const back = (
    <Link to={`/reports${listSearch}`} className="back-link" data-testid="back-link">
      <span aria-hidden="true">←</span> Reports
    </Link>
  );

  if (notFound) {
    return (
      <>
        {back}
        <PageHeader title="Report not found">There is no report with this address.</PageHeader>
        <div className="state" data-testid="not-found">
          <Link className="btn btn-primary" to="/reports">
            Back to reports
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      {back}
      <PageHeader
        title={data ? `${data.job.reference} · ${data.job.title}` : "Report"}
        actions={
          data && (
            <div className="badges">
              <ReviewBadge status={data.review_status} />
              <BillingBadge status={data.billing_status} />
            </div>
          )
        }
      />
      <QueryBoundary query={query} what="this report" skeletonRows={6}>
        {(r) => <Detail r={r} onImageError={refreshPhotoUrls} version={query.dataUpdatedAt} />}
      </QueryBoundary>
    </>
  );
}
