"""SQL twins of the pure functions in `billing.py`, used only to filter and aggregate.

Displayed statuses are always computed with the pure functions; these expressions must agree with
them, which `tests/test_billing_sql.py` checks over the whole seeded dataset.
"""

import datetime as dt
from typing import Any

from sqlalchemy import String, case, exists, func, literal_column, select
from sqlalchemy.orm import aliased
from sqlalchemy.sql.elements import ColumnElement

from app.models import Invoice, Payment
from app.models.enums import InvoiceState, PaymentKind
from app.services.billing import BillingStatus, InvoiceStatus


def _const(value: str) -> ColumnElement[str]:
    # Values come from our own enums, never from the request, so inlining them is safe.
    return literal_column(f"'{value}'", String)


def paid_expr(invoice: type[Invoice]) -> ColumnElement[int]:
    """Sum of payments received against `invoice` (0 when none), as a correlated subquery."""
    total = (
        select(func.coalesce(func.sum(Payment.amount_pence), 0))
        .where(Payment.kind == PaymentKind.invoice, Payment.invoice_id == invoice.id)
        .scalar_subquery()
    )
    return total


def invoice_status_expr(
    invoice: type[Invoice], paid: ColumnElement[int], today: dt.date
) -> ColumnElement[str]:
    """Mirror of `billing.invoice_status`: void > draft > paid > overdue > part_paid > sent."""
    return case(
        (invoice.state == InvoiceState.void, _const(InvoiceStatus.void)),
        (invoice.state == InvoiceState.draft, _const(InvoiceStatus.draft)),
        (invoice.total_pence - paid <= 0, _const(InvoiceStatus.paid)),
        (invoice.due_date < today, _const(InvoiceStatus.overdue)),
        (paid > 0, _const(InvoiceStatus.part_paid)),
        else_=_const(InvoiceStatus.sent),
    )


def balance_expr(invoice: type[Invoice], paid: ColumnElement[int]) -> ColumnElement[int]:
    return func.greatest(invoice.total_pence - paid, 0)


def has_void_invoice_expr(job_id: Any) -> ColumnElement[bool]:
    """True when the job has at least one void invoice."""
    void_invoice = aliased(Invoice)
    return exists().where(void_invoice.job_id == job_id, void_invoice.state == InvoiceState.void)


def billing_status_expr(
    job_id: Any, live_invoice: type[Invoice], live_status: ColumnElement[str]
) -> ColumnElement[str]:
    """Mirror of `billing.billing_status` for a job.

    `live_invoice` is the job's (at most one) non-void invoice, outer-joined; `live_status` its
    status. A job with only void invoices is `void`; with none, `not_invoiced`.
    """
    return case(
        (live_invoice.id.is_not(None), live_status),
        (has_void_invoice_expr(job_id), _const(BillingStatus.void)),
        else_=_const(BillingStatus.not_invoiced),
    )


def live_invoice_join_condition(job_id: Any, live_invoice: type[Invoice]) -> Any:
    return (live_invoice.job_id == job_id) & (live_invoice.state != InvoiceState.void)
