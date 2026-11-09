"""Consistency checks over a built dataset (ticket scenario 5), shared by tests and sweeps."""

from collections import Counter
from datetime import date, timedelta

from app.clock import LONDON
from app.models.enums import InvoiceState, PaymentKind, ReviewStatus
from app.seed.dataset import Dataset, month_start
from app.services.billing import InvoiceStatus, invoice_status


def paid_by_invoice(ds: Dataset) -> Counter[object]:
    paid: Counter[object] = Counter()
    for payment in ds.payments:
        if payment.invoice_id:
            paid[payment.invoice_id] += payment.amount_pence
    return paid


def invoice_statuses(ds: Dataset, today: date) -> dict[object, InvoiceStatus]:
    paid = paid_by_invoice(ds)
    return {
        inv.id: invoice_status(inv.state, inv.total_pence, paid[inv.id], inv.due_date, today)
        for inv in ds.invoices
    }


def check_consistency(ds: Dataset) -> None:
    """Rules of the original 60-job dataset; the operative's day has its own tests."""
    ds = ds.without_operative_day()
    anchor = ds.anchor
    jobs = {j.id: j for j in ds.jobs}
    customers = {c.id: c for c in ds.customers}
    reports = {r.job_id: r for r in ds.reports}
    reports_by_id = {r.id: r for r in ds.reports}
    quotes = {q.id: q for q in ds.quotes}

    for job in ds.jobs:
        assert job.completed_on is not None
        assert job.scheduled_start <= job.completed_on <= anchor, job.reference

    for photo in ds.photos:
        assert photo.taken_at < reports_by_id[photo.report_id].submitted_at

    for report in ds.reports:
        if report.review_status is ReviewStatus.reviewed:
            assert report.reviewed_at is not None and report.reviewed_by_id is not None
            assert report.reviewed_at > report.submitted_at
            assert report.reviewed_at.astimezone(LONDON).date() <= anchor
        else:
            assert report.reviewed_at is None and report.reviewed_by_id is None

    paid = paid_by_invoice(ds)
    statuses = invoice_statuses(ds, anchor)
    for inv in ds.invoices:
        job = jobs[inv.job_id]
        assert inv.customer_id == job.customer_id
        terms = customers[inv.customer_id].payment_terms_days
        if inv.state is InvoiceState.draft:
            assert inv.issue_date is None and inv.due_date is None
            assert paid[inv.id] == 0
            continue
        assert inv.issue_date is not None and inv.due_date is not None
        reviewed_at = reports[inv.job_id].reviewed_at
        assert reviewed_at is not None
        assert inv.issue_date >= reviewed_at.astimezone(LONDON).date()
        assert inv.issue_date <= anchor
        assert inv.due_date == inv.issue_date + timedelta(days=terms)
        status = statuses[inv.id]
        if status is InvoiceStatus.paid:
            assert paid[inv.id] == inv.total_pence
        elif status in (InvoiceStatus.part_paid, InvoiceStatus.overdue) and paid[inv.id]:
            assert 0 < paid[inv.id] < inv.total_pence
        if status is InvoiceStatus.void:
            assert paid[inv.id] == 0
        assert inv.total_pence == inv.subtotal_pence + inv.vat_pence - inv.deposit_applied_pence

    for payment in ds.payments:
        received = payment.received_at.astimezone(LONDON).date()
        assert received <= anchor
        if payment.kind is PaymentKind.deposit:
            assert payment.quote_id is not None
            quote = quotes[payment.quote_id]
            assert received < jobs[quote.job_id].scheduled_start
            assert received >= quote.accepted_on if quote.accepted_on else True
        else:
            inv = next(i for i in ds.invoices if i.id == payment.invoice_id)
            assert inv.issue_date is not None and received >= inv.issue_date

    m0 = month_start(anchor, 0)
    assert sum(1 for j in ds.jobs if j.completed_on and j.completed_on >= m0) == 8
    if anchor.day >= 10:
        issued_in_m0 = [i for i in ds.invoices if i.issue_date and i.issue_date >= m0]
        assert len(issued_in_m0) >= 3
