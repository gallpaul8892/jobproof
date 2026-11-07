import { useEffect, type ReactNode } from "react";
import {
  billingStatusLabel,
  reviewStatusLabel,
  type BillingStatus,
  type InvoiceStatus,
  type ReviewStatus,
} from "@jobproof/shared";

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · JobProof`;
  }, [title]);
}

const BILLING_TONE: Record<string, string> = {
  not_invoiced: "neutral",
  draft: "slate",
  sent: "blue",
  part_paid: "violet",
  overdue: "red",
  paid: "green",
  void: "void",
};

function Dot() {
  return <span className="badge-dot" aria-hidden="true" />;
}

export function ReviewBadge({ status }: { status: ReviewStatus }) {
  return (
    <span className={`badge badge-${status === "reviewed" ? "green" : "amber"}`} data-status={status}>
      <Dot />
      {reviewStatusLabel(status)}
    </span>
  );
}

export function BillingBadge({ status }: { status: BillingStatus | InvoiceStatus }) {
  return (
    <span className={`badge badge-${BILLING_TONE[status] ?? "neutral"}`} data-status={status}>
      <Dot />
      {billingStatusLabel(status)}
    </span>
  );
}

export function PageHeader({
  title,
  children,
  actions,
}: {
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {children && <p className="page-sub">{children}</p>}
      </div>
      {actions}
    </div>
  );
}

/** Horizontally scrollable table container that is reachable by keyboard. */
export function TableWrap({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="table-wrap" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  noun,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  noun: string;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className="pagination" aria-label={`${noun} pages`}>
      <button type="button" className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span className="pagination-label" data-testid="page-label">
        Page {page} of {pages}
      </span>
      <button type="button" className="btn" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </nav>
  );
}

export function resultLine(page: number, pageSize: number, total: number, items: number, noun: string) {
  if (total === 0 || items === 0) return `${total} ${noun}`;
  const start = (page - 1) * pageSize + 1;
  return `Showing ${start}-${start + items - 1} of ${total} ${noun}`;
}
