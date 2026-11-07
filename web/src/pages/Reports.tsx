import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { useQueryParams } from "../app/useQueryParams";
import {
  BILLING_STATUSES,
  PAGE_SIZE,
  REVIEW_STATUSES,
  billingStatusLabel,
  formatAddressShort,
  formatDate,
  hasActiveFilters,
  parseReportFilters,
  reviewStatusLabel,
  serialiseFilters,
  usePainters,
  useReports,
  type ReportFilters,
} from "@jobproof/shared";
import { EmptyState, QueryBoundary } from "../components/QueryBoundary";
import {
  BillingBadge,
  PageHeader,
  Pagination,
  ReviewBadge,
  TableWrap,
  resultLine,
  useDocumentTitle,
} from "../components/ui";

/** Search box with a 300 ms debounce. The URL is the source of truth; a draft only lives while it differs. */
function SearchBox({ value, onCommit }: { value: string; onCommit: (q: string) => void }) {
  const [draft, setDraft] = useState({ text: "", base: value });
  const text = draft.base === value ? draft.text : value;

  useEffect(() => {
    if (draft.base !== value) return;
    const trimmed = draft.text.trim();
    if (trimmed === value) return;
    const timer = setTimeout(() => {
      // Keep what was typed (including a trailing space) while the URL catches up.
      setDraft({ text: draft.text, base: trimmed });
      onCommit(trimmed);
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, value, onCommit]);

  return (
    <div className="field field-search">
      <label htmlFor="search">Search</label>
      <input
        id="search"
        type="search"
        maxLength={100}
        placeholder="Customer, address or job ref"
        value={text}
        onChange={(e) => setDraft({ text: e.target.value, base: value })}
        data-testid="search-input"
      />
    </div>
  );
}

export function ReportsPage() {
  useDocumentTitle("Reports");
  const [params, setParams] = useQueryParams();
  const location = useLocation();
  const filters = parseReportFilters(params);
  const query = useReports(filters);
  const painters = usePainters();

  const update = useCallback(
    (patch: Partial<ReportFilters>, replace = false) => {
      const next = parseReportFilters(params);
      Object.assign(next, patch, { page: patch.page ?? 1 });
      setParams(serialiseFilters(next), { replace });
    },
    [params, setParams],
  );
  const commitSearch = useCallback((q: string) => update({ q: q || undefined }, true), [update]);
  const set = (key: keyof ReportFilters) => (e: { target: { value: string } }) =>
    update({ [key]: e.target.value || undefined });

  const active = hasActiveFilters(filters);
  const clear = () => setParams(new URLSearchParams());

  return (
    <>
      <PageHeader title="Reports">Completion reports submitted by painters, newest first.</PageHeader>

      <form className="filters" role="search" aria-label="Filter reports" onSubmit={(e) => e.preventDefault()}>
        <SearchBox value={filters.q ?? ""} onCommit={commitSearch} />
        <div className="field">
          <label htmlFor="review_status">Review status</label>
          <select id="review_status" value={filters.review_status ?? ""} onChange={set("review_status")}>
            <option value="">All</option>
            {REVIEW_STATUSES.map((s) => (
              <option key={s} value={s}>
                {reviewStatusLabel(s)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="billing_status">Billing status</label>
          <select id="billing_status" value={filters.billing_status ?? ""} onChange={set("billing_status")}>
            <option value="">All</option>
            {BILLING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {billingStatusLabel(s)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="painter_id">Painter</label>
          <select id="painter_id" value={filters.painter_id ?? ""} onChange={set("painter_id")}>
            <option value="">All</option>
            {painters.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="date_from">Completed from</label>
          <input
            id="date_from"
            type="date"
            value={filters.date_from ?? ""}
            max={filters.date_to}
            onChange={set("date_from")}
          />
        </div>
        <div className="field">
          <label htmlFor="date_to">Completed to</label>
          <input
            id="date_to"
            type="date"
            value={filters.date_to ?? ""}
            min={filters.date_from}
            onChange={set("date_to")}
          />
        </div>
        <button type="button" className="btn" onClick={clear} disabled={!active}>
          Clear filters
        </button>
      </form>

      <QueryBoundary query={query} what="reports">
        {(data) => (
          <>
            <p className="result-count" data-testid="result-count" aria-live="polite">
              {resultLine(data.page, data.page_size, data.total, data.items.length, "reports")}
            </p>
            {data.items.length === 0 ? (
              data.total > 0 ? (
                <EmptyState title="There are no reports on this page">
                  <button type="button" className="btn" onClick={() => update({ page: 1 })}>
                    Go to the first page
                  </button>
                </EmptyState>
              ) : active ? (
                <EmptyState title="No reports match these filters">
                  <p className="muted">Try a different search or loosen the filters.</p>
                  <button type="button" className="btn btn-primary" onClick={clear}>
                    Clear filters
                  </button>
                </EmptyState>
              ) : (
                <EmptyState title="No reports yet">
                  <p className="muted">Reports appear here when painters submit them.</p>
                </EmptyState>
              )
            ) : (
              <>
                <TableWrap label="Job reports">
                  <table className="table" data-testid="reports-table">
                    <thead>
                      <tr>
                        <th scope="col">Job ref</th>
                        <th scope="col">Customer</th>
                        <th scope="col">Site address</th>
                        <th scope="col">Painter</th>
                        <th scope="col">Completed</th>
                        <th scope="col" className="num">
                          Photos
                        </th>
                        <th scope="col">Review</th>
                        <th scope="col">Billing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((r) => (
                        <tr key={r.id} data-testid="report-row">
                          <td className="nowrap">
                            <Link
                              to={`/reports/${r.id}`}
                              state={{ listSearch: location.search }}
                              className="strong"
                            >
                              {r.job_reference}
                            </Link>
                          </td>
                          <td>{r.customer.name}</td>
                          <td className="truncate" title={formatAddressShort(r.site_address)}>
                            {formatAddressShort(r.site_address)}
                          </td>
                          <td>{r.painter.name}</td>
                          <td className="nowrap">{formatDate(r.completed_on)}</td>
                          <td className="num">{r.photo_count}</td>
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
                <Pagination
                  page={data.page}
                  pageSize={data.page_size || PAGE_SIZE}
                  total={data.total}
                  noun="Reports"
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
