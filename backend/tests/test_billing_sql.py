"""The SQL status expressions must agree with the pure functions on every day and every row."""

import datetime as dt
from typing import Any

import pytest
from sqlalchemy.orm import Session

from app.services.billing import BillingStatus, InvoiceStatus
from app.services.invoices import list_invoices
from app.services.reports import ReportFilters, list_reports
from tests.expected import expected_reports, invoice_statuses_at

# Days chosen so invoices cross every boundary: nothing overdue yet up to everything overdue.
DAYS = [
    dt.date(2026, 3, 1),
    dt.date(2026, 9, 1),
    dt.date(2026, 10, 14),
    dt.date(2026, 10, 15),
    dt.date(2026, 10, 29),
    dt.date(2026, 11, 20),
    dt.date(2027, 6, 1),
]


@pytest.mark.parametrize("today", DAYS)
def test_invoice_status_filter_matches_the_pure_function(
    db_engine: Any, ds: Any, today: dt.date
) -> None:
    statuses = invoice_statuses_at(ds, today)
    with Session(db_engine) as session:
        for status in InvoiceStatus:
            want = {str(i) for i, s in statuses.items() if s is status}
            page = list_invoices(session, status, page=1, page_size=100, today=today)
            assert {str(i.id) for i in page.items} == want, (status, today)
            assert page.total == len(want)
            assert {i.status for i in page.items} <= {status}


@pytest.mark.parametrize("today", DAYS)
def test_report_billing_filter_matches_the_pure_function(
    db_engine: Any, ds: Any, today: dt.date
) -> None:
    rows = expected_reports(ds, today)
    with Session(db_engine) as session:
        for status in BillingStatus:
            want = [str(r.report.id) for r in rows if r.billing is status]
            page = list_reports(
                session,
                ReportFilters(billing_status=status),
                page=1,
                page_size=100,
                today=today,
            )
            assert [str(i.id) for i in page.items] == want, (status, today)
            assert page.total == len(want)
            assert {i.billing_status for i in page.items} <= {status}
