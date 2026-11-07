import datetime as dt

import pytest

from app.models.enums import InvoiceState
from app.services.billing import (
    BillingStatus,
    InvoiceStatus,
    balance_pence,
    billing_status,
    invoice_status,
    paid_pence,
)

TODAY = dt.date(2026, 10, 15)
PAST = TODAY - dt.timedelta(days=1)
FUTURE = TODAY + dt.timedelta(days=5)


@pytest.mark.parametrize(
    ("label", "state", "total", "paid", "due", "expected"),
    [
        ("void", InvoiceState.void, 12000, 0, PAST, InvoiceStatus.void),
        ("void even if paid", InvoiceState.void, 12000, 12000, PAST, InvoiceStatus.void),
        ("draft", InvoiceState.draft, 12000, 0, None, InvoiceStatus.draft),
        ("fully paid past due", InvoiceState.issued, 12000, 12000, PAST, InvoiceStatus.paid),
        ("unpaid past due", InvoiceState.issued, 12000, 0, PAST, InvoiceStatus.overdue),
        ("part paid past due", InvoiceState.issued, 12000, 5000, PAST, InvoiceStatus.overdue),
        ("part paid in terms", InvoiceState.issued, 12000, 5000, FUTURE, InvoiceStatus.part_paid),
        ("unpaid in terms", InvoiceState.issued, 12000, 0, FUTURE, InvoiceStatus.sent),
        ("due date equal to today", InvoiceState.issued, 12000, 0, TODAY, InvoiceStatus.sent),
        ("overpaid counts as paid", InvoiceState.issued, 12000, 13000, PAST, InvoiceStatus.paid),
    ],
)
def test_invoice_status_table(
    label: str,
    state: InvoiceState,
    total: int,
    paid: int,
    due: dt.date | None,
    expected: InvoiceStatus,
) -> None:
    assert invoice_status(state, total, paid, due, TODAY) is expected, label


def test_paid_and_balance() -> None:
    assert paid_pence([100, 250]) == 350
    assert paid_pence([]) == 0
    assert balance_pence(1000, 350) == 650
    assert balance_pence(1000, 1200) == 0


@pytest.mark.parametrize(
    ("invoices", "expected"),
    [
        ([], BillingStatus.not_invoiced),
        ([(InvoiceState.issued, InvoiceStatus.overdue)], BillingStatus.overdue),
        ([(InvoiceState.draft, InvoiceStatus.draft)], BillingStatus.draft),
        ([(InvoiceState.void, InvoiceStatus.void)], BillingStatus.void),
        (
            [
                (InvoiceState.void, InvoiceStatus.void),
                (InvoiceState.issued, InvoiceStatus.part_paid),
            ],
            BillingStatus.part_paid,
        ),
    ],
)
def test_billing_status(
    invoices: list[tuple[InvoiceState, InvoiceStatus]], expected: BillingStatus
) -> None:
    assert billing_status(invoices) is expected
