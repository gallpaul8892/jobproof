import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  billingStatusLabel,
  reviewStatusLabel,
  type BillingStatus,
  type InvoiceStatus,
  type ReviewStatus,
} from "@jobproof/shared";
import { useCompanyName } from "../theme/BrandingProvider";

/** "Page | Company", or just "Page" before the company name is known. Text only, never HTML. */
export function useDocumentTitle(title: string): void {
  const name = useCompanyName();
  useEffect(() => {
    document.title = name ? `${title} | ${name}` : title;
  }, [title, name]);
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

/**
 * Horizontally scrollable table container that is reachable by keyboard. When the table is
 * wider than the container it shows edge shadows (CSS) and a text hint, so the scroll is visible.
 */
export function TableWrap({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const check = () => setScrollable(el.scrollWidth > el.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {scrollable && (
        <p className="scroll-hint" data-testid="scroll-hint">
          This table is wider than the screen. Scroll sideways to see every column.
        </p>
      )}
      <div
        ref={ref}
        className="table-wrap"
        data-scrollable={scrollable ? "true" : "false"}
        role="region"
        aria-label={label}
        tabIndex={0}
      >
        {children}
      </div>
    </>
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
