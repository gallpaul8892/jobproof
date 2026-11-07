"""Derived billing values. Pure functions: no database, no clock.

`today` is always passed in (London today from `app.clock`). SQL filters elsewhere must match
`invoice_status`; tests compare the two over the whole seeded dataset.
"""

import datetime as dt
from collections.abc import Iterable
from enum import StrEnum

from app.models.enums import InvoiceState


class InvoiceStatus(StrEnum):
    draft = "draft"
    sent = "sent"
    part_paid = "part_paid"
    overdue = "overdue"
    paid = "paid"
    void = "void"


class BillingStatus(StrEnum):
    not_invoiced = "not_invoiced"
    draft = "draft"
    sent = "sent"
    part_paid = "part_paid"
    overdue = "overdue"
    paid = "paid"
    void = "void"


def paid_pence(payment_amounts: Iterable[int]) -> int:
    """Sum of the payments received against an invoice."""
    return sum(payment_amounts)


def balance_pence(total_pence: int, paid: int) -> int:
    """Unpaid amount, never negative."""
    return max(total_pence - paid, 0)


def invoice_status(
    state: InvoiceState,
    total_pence: int,
    paid: int,
    due_date: dt.date | None,
    today: dt.date,
) -> InvoiceStatus:
    """Display status: void > draft > paid > overdue > part_paid > sent."""
    if state == InvoiceState.void:
        return InvoiceStatus.void
    if state == InvoiceState.draft:
        return InvoiceStatus.draft
    if balance_pence(total_pence, paid) == 0:
        return InvoiceStatus.paid
    if due_date is not None and due_date < today:
        return InvoiceStatus.overdue
    if paid > 0:
        return InvoiceStatus.part_paid
    return InvoiceStatus.sent


def billing_status(invoice_statuses: Iterable[tuple[InvoiceState, InvoiceStatus]]) -> BillingStatus:
    """Billing status of a job from its invoices' (stored state, display status) pairs.

    The job's non-void invoice decides; a job whose invoices are all void is `void`; a job with
    no invoice is `not_invoiced`.
    """
    seen_void = False
    for state, status in invoice_statuses:
        if state == InvoiceState.void:
            seen_void = True
        else:
            return BillingStatus(status.value)
    return BillingStatus.void if seen_void else BillingStatus.not_invoiced
