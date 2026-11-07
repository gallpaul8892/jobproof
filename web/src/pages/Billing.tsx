import { Link } from "react-router";
import { useQueryParams } from "../app/useQueryParams";
import {
  INVOICE_STATUSES,
  PAGE_SIZE,
  billingStatusLabel,
  formatDate,
  formatPence,
  hasActiveFilters,
  parseInvoiceFilters,
  serialiseFilters,
  useInvoices,
  type InvoiceFilters,
} from "@jobproof/shared";
import { EmptyState, QueryBoundary } from "../components/QueryBoundary";
import { BillingBadge, PageHeader, Pagination, TableWrap, resultLine, useDocumentTitle } from "../components/ui";

export function BillingPage() {
  useDocumentTitle("Billing");
  const [params, setParams] = useQueryParams();
  const filters = parseInvoiceFilters(params);
  const query = useInvoices(filters);
  const active = hasActiveFilters(filters);

  function update(patch: Partial<InvoiceFilters>) {
    setParams(serialiseFilters({ ...filters, ...patch, page: patch.page ?? 1 }));
  }

  return (
    <>
      <PageHeader title="Billing">Invoices, drafts first, then newest issued.</PageHeader>
      <form className="filters" role="search" aria-label="Filter invoices" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label htmlFor="status">Status</label>
          <select
            id="status"
            value={filters.status ?? ""}
            onChange={(e) => update({ status: (e.target.value || undefined) as InvoiceFilters["status"] })}
          >
            <option value="">All</option>
            {INVOICE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {billingStatusLabel(s)}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn" disabled={!active} onClick={() => setParams(new URLSearchParams())}>
          Clear filter
        </button>
      </form>

      <QueryBoundary query={query} what="invoices">
        {(data) => (
          <>
            <p className="result-count" data-testid="result-count" aria-live="polite">
              {resultLine(data.page, data.page_size, data.total, data.items.length, "invoices")}
            </p>
            {data.items.length === 0 ? (
              data.total > 0 ? (
                <EmptyState title="There are no invoices on this page">
                  <button type="button" className="btn" onClick={() => update({ page: 1 })}>
                    Go to the first page
                  </button>
                </EmptyState>
              ) : active ? (
                <EmptyState title="No invoices with this status">
                  <button type="button" className="btn btn-primary" onClick={() => setParams(new URLSearchParams())}>
                    Show all invoices
                  </button>
                </EmptyState>
              ) : (
                <EmptyState title="No invoices yet" />
              )
            ) : (
              <>
                <TableWrap label="Invoices">
                  <table className="table" data-testid="invoices-table">
                    <thead>
                      <tr>
                        <th scope="col">Invoice no.</th>
                        <th scope="col">Customer</th>
                        <th scope="col">Job ref</th>
                        <th scope="col" className="num">
                          Amount
                        </th>
                        <th scope="col" className="num">
                          Paid
                        </th>
                        <th scope="col">Due date</th>
                        <th scope="col">Status</th>
                        <th scope="col">
                          <span className="sr-only">Report</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((inv) => (
                        <tr key={inv.id} data-testid="invoice-row">
                          <td className="strong nowrap">{inv.number}</td>
                          <td>{inv.customer.name}</td>
                          <td className="nowrap">{inv.job_reference}</td>
                          <td className="num">{formatPence(inv.total_pence)}</td>
                          <td className="num">{formatPence(inv.paid_pence)}</td>
                          <td className="nowrap">{inv.due_date ? formatDate(inv.due_date) : "-"}</td>
                          <td>
                            <BillingBadge status={inv.status} />
                          </td>
                          <td>
                            {inv.report_id ? (
                              <Link to={`/reports/${inv.report_id}`}>
                                View report<span className="sr-only"> for {inv.job_reference}</span>
                              </Link>
                            ) : (
                              <span className="muted">No report</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
                <Pagination
                  page={data.page}
                  pageSize={data.page_size || PAGE_SIZE}
                  total={data.total}
                  noun="Invoices"
                  onPage={(page) => update({ page })}
                />
              </>
            )}
          </>
        )}
      </QueryBoundary>
    </>
  );
}
