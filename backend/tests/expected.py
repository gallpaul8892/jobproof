"""Expected API values computed from `build_dataset()` in plain Python.

Independent of the SQL services on purpose: these are what the endpoints must agree with.
"""

import calendar
import datetime as dt
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

from app.models.enums import InvoiceState, PaymentKind, ReviewStatus
from app.seed.dataset import (
    CustomerRow,
    Dataset,
    InvoiceRow,
    JobRow,
    ReportRow,
    UserRow,
    month_start,
)
from app.services.billing import (
    BillingStatus,
    InvoiceStatus,
    balance_pence,
    billing_status,
    invoice_status,
)
from tests.dataset_checks import paid_by_invoice


@dataclass(frozen=True)
class ExpectedReport:
    report: ReportRow
    job: JobRow
    customer: CustomerRow
    painter: UserRow
    photo_count: int
    billing: BillingStatus


def invoice_statuses_at(ds: Dataset, today: dt.date) -> dict[Any, InvoiceStatus]:
    paid = paid_by_invoice(ds)
    return {
        inv.id: invoice_status(inv.state, inv.total_pence, paid[inv.id], inv.due_date, today)
        for inv in ds.invoices
    }


def expected_reports(ds: Dataset, today: dt.date) -> list[ExpectedReport]:
    """Every report in the API's fixed order: completed_on, submitted_at, job reference, desc."""
    jobs = {j.id: j for j in ds.jobs}
    customers = {c.id: c for c in ds.customers}
    users = {u.id: u for u in ds.users}
    statuses = invoice_statuses_at(ds, today)
    by_job: dict[Any, list[tuple[InvoiceState, InvoiceStatus]]] = defaultdict(list)
    for inv in ds.invoices:
        by_job[inv.job_id].append((inv.state, statuses[inv.id]))
    photo_counts: dict[Any, int] = defaultdict(int)
    for photo in ds.photos:
        photo_counts[photo.report_id] += 1
    rows = [
        ExpectedReport(
            report=r,
            job=jobs[r.job_id],
            customer=customers[jobs[r.job_id].customer_id],
            painter=users[r.painter_id],
            photo_count=photo_counts[r.id],
            billing=billing_status(by_job[r.job_id]),
        )
        for r in ds.reports
    ]
    rows.sort(
        key=lambda e: (e.job.completed_on, e.report.submitted_at, e.job.reference), reverse=True
    )
    return rows


def search_matches(row: ExpectedReport, q: str) -> bool:
    needle = q.strip().lower()
    job = row.job
    fields = [
        row.customer.name,
        job.site_line1,
        job.site_line2 or "",
        job.site_town,
        job.site_county or "",
        job.site_postcode,
        job.reference,
    ]
    if any(needle in f.lower() for f in fields):
        return True
    squashed = "".join(needle.split())
    return bool(squashed) and squashed in job.site_postcode.replace(" ", "").lower()


@dataclass(frozen=True)
class ExpectedDashboard:
    awaiting: int
    completed_this_month: int
    invoiced_this_month: int
    outstanding: int
    overdue: int
    period_start: dt.date
    period_end: dt.date


def expected_dashboard(ds: Dataset, today: dt.date) -> ExpectedDashboard:
    start = month_start(today, 0)
    end = today.replace(day=calendar.monthrange(today.year, today.month)[1])
    paid = paid_by_invoice(ds)
    statuses = invoice_statuses_at(ds, today)
    live = (InvoiceStatus.sent, InvoiceStatus.part_paid, InvoiceStatus.overdue)
    return ExpectedDashboard(
        awaiting=sum(r.review_status is ReviewStatus.awaiting_review for r in ds.reports),
        completed_this_month=sum(
            j.completed_on is not None and start <= j.completed_on <= end for j in ds.jobs
        ),
        invoiced_this_month=sum(
            i.total_pence
            for i in ds.invoices
            if i.state is InvoiceState.issued
            and i.issue_date is not None
            and start <= i.issue_date <= end
        ),
        outstanding=sum(
            balance_pence(i.total_pence, paid[i.id]) for i in ds.invoices if statuses[i.id] in live
        ),
        overdue=sum(s is InvoiceStatus.overdue for s in statuses.values()),
        period_start=start,
        period_end=end,
    )


def expected_invoices(ds: Dataset, today: dt.date) -> list[InvoiceRow]:
    """Invoices in API order: drafts (no issue date) first, then issue_date desc, number desc."""
    drafts = sorted((i for i in ds.invoices if i.issue_date is None), key=lambda i: i.number)
    drafts.reverse()
    issued = sorted(
        (i for i in ds.invoices if i.issue_date is not None),
        key=lambda i: (i.issue_date, i.number),
        reverse=True,
    )
    return drafts + issued


def deposit_paid_by_quote(ds: Dataset) -> dict[Any, int]:
    paid: dict[Any, int] = defaultdict(int)
    for p in ds.payments:
        if p.kind is PaymentKind.deposit and p.quote_id is not None:
            paid[p.quote_id] += p.amount_pence
    return paid


def parse_ts(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


# ---- T-002b determinism rule --------------------------------------------------------------------
# SHA-256 over every table except users for build_dataset(date(2026, 11, 7)), recorded from a
# database seeded by the code that existed before T-002b. Adding the second manager and the admin
# must not change a single other row.
NON_USER_TABLES_CHECKSUM_2026_11_07 = (
    "6c5f949ff4b676d2b379598e56dc08af2273283ea03e880b9f2311bd9caf77ab"
)


def non_user_tables_checksum(ds: Dataset) -> str:
    import dataclasses
    import hashlib

    digest = hashlib.sha256()
    ds = ds.without_operative_day()  # T-003c rows are new; the original rows must not change
    for name, rows in sorted(ds.tables()):
        if name in ("users", "job_checklist_items"):
            continue
        normalised = []
        for row in rows:
            fields = dataclasses.asdict(row)  # type: ignore[call-overload]
            if fields.get("manager_notes", "") is None:
                del fields["manager_notes"]  # T-002i column, null in the seed: hash as before
            # T-003c columns, default-valued for every original row: hash as before
            if name == "job_reports":
                del fields["state"], fields["submitted_by_id"]
            if name == "report_checklist_items":
                del fields["cannot_do"]
            normalised.append(
                sorted(
                    (
                        key,
                        value.astimezone(dt.UTC).isoformat()
                        if isinstance(value, dt.datetime)
                        else str(value),
                    )
                    for key, value in fields.items()
                )
            )
        normalised.sort(key=lambda fields: dict(fields)["id"])
        digest.update(name.encode())
        digest.update(repr(normalised).encode())
    return digest.hexdigest()
