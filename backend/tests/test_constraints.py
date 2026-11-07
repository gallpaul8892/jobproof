"""Scenario 2: the database rejects invalid data."""

import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from sqlalchemy import Connection, create_engine, text
from sqlalchemy.exc import IntegrityError

from tests.conftest import TEST_DATABASE_URL


@pytest.fixture(scope="module")
def conn() -> Iterator[Connection]:
    engine = create_engine(TEST_DATABASE_URL)
    with engine.connect() as connection:
        yield connection
    engine.dispose()


def _one(conn: Connection, sql: str) -> Any:
    row = conn.execute(text(sql)).one()
    return row[0] if len(row) == 1 else row


def _attempt(conn: Connection, sql: str, params: dict[str, Any]) -> None:
    """Run one statement and always roll it back."""
    try:
        conn.execute(text(sql), params)
    finally:
        conn.rollback()


INVOICE_SQL = """
INSERT INTO invoices (job_id, customer_id, number, state, subtotal_pence, vat_pence,
    deposit_applied_pence, total_pence, issue_date, due_date)
VALUES (:job, :customer, :number, :state, :sub, :vat, :dep, :total, :issue, :due)
"""


def _uninvoiced_job(conn: Connection) -> tuple[uuid.UUID, uuid.UUID]:
    row = conn.execute(
        text(
            "SELECT j.id, j.customer_id FROM jobs j "
            "WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.job_id = j.id) LIMIT 1"
        )
    ).one()
    return row[0], row[1]


def _invoice_params(job: uuid.UUID, customer: uuid.UUID, **overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {
        "job": job,
        "customer": customer,
        "number": "INV-9001",
        "state": "issued",
        "sub": 10000,
        "vat": 2000,
        "dep": 1000,
        "total": 11000,
        "issue": "2026-10-01",
        "due": "2026-10-15",
    }
    params.update(overrides)
    return params


def test_control_a_valid_invoice_inserts(conn: Connection) -> None:
    job, customer = _uninvoiced_job(conn)
    _attempt(conn, INVOICE_SQL, _invoice_params(job, customer))  # no error


@pytest.mark.parametrize(
    ("label", "overrides"),
    [
        ("total != subtotal + VAT - deposit", {"total": 11001}),
        ("draft invoice with an issue date", {"state": "draft", "due": None}),
        ("draft invoice with a due date", {"state": "draft", "issue": None}),
        ("issued invoice without dates", {"issue": None, "due": None}),
        ("due before issue", {"due": "2026-09-30"}),
        ("zero total", {"sub": 0, "vat": 0, "dep": 0, "total": 0}),
    ],
)
def test_invalid_invoices_are_rejected(
    conn: Connection, label: str, overrides: dict[str, Any]
) -> None:
    job, customer = _uninvoiced_job(conn)
    with pytest.raises(IntegrityError):
        _attempt(conn, INVOICE_SQL, _invoice_params(job, customer, **overrides))


def test_second_non_void_invoice_for_a_job_is_rejected(conn: Connection) -> None:
    job, customer = _one(
        conn,
        "SELECT job_id, customer_id FROM invoices WHERE state = 'issued' LIMIT 1",
    )
    with pytest.raises(IntegrityError):
        _attempt(conn, INVOICE_SQL, _invoice_params(job, customer))


def test_void_invoice_may_coexist_with_a_live_one(conn: Connection) -> None:
    job, customer = _one(
        conn,
        "SELECT job_id, customer_id FROM invoices WHERE state = 'issued' LIMIT 1",
    )
    _attempt(conn, INVOICE_SQL, _invoice_params(job, customer, state="void"))  # no error


PAYMENT_SQL = """
INSERT INTO payments (kind, quote_id, invoice_id, amount_pence, currency, method, received_at)
VALUES (:kind, :quote, :invoice, :amount, :currency, 'card', now())
"""


def test_payment_rules(conn: Connection) -> None:
    quote = _one(conn, "SELECT id FROM quotes LIMIT 1")
    invoice = _one(conn, "SELECT id FROM invoices WHERE state = 'issued' LIMIT 1")
    valid = {"kind": "deposit", "quote": quote, "invoice": None, "amount": 500, "currency": "GBP"}
    _attempt(conn, PAYMENT_SQL, valid)  # control: no error
    _attempt(conn, PAYMENT_SQL, {**valid, "kind": "invoice", "quote": None, "invoice": invoice})
    bad: list[dict[str, Any]] = [
        {**valid, "invoice": invoice},  # deposit with an invoice_id
        {**valid, "quote": None},  # deposit with no quote
        {**valid, "kind": "invoice", "quote": quote, "invoice": invoice},  # invoice with a quote
        {**valid, "kind": "invoice", "quote": None, "invoice": None},
        {**valid, "amount": 0},
        {**valid, "currency": "USD"},
    ]
    for params in bad:
        with pytest.raises(IntegrityError):
            _attempt(conn, PAYMENT_SQL, params)


JOB_SQL = """
INSERT INTO jobs (reference, customer_id, job_type, title, status, site_line1, site_town,
    site_postcode, scheduled_start, completed_on)
VALUES (:ref, :customer, 'interior_repaint', 't', :status, 'l1', 'Bristol', 'BS1 1AA',
    '2026-10-01', :completed)
"""


def test_job_status_and_completed_on_must_agree(conn: Connection) -> None:
    customer = _one(conn, "SELECT id FROM customers LIMIT 1")
    ok = {"ref": "JP-9001", "customer": customer, "status": "completed", "completed": "2026-10-02"}
    _attempt(conn, JOB_SQL, ok)  # control: no error
    _attempt(conn, JOB_SQL, {**ok, "status": "scheduled", "completed": None})
    for params in (
        {**ok, "completed": None},  # completed with no completed_on
        {**ok, "status": "scheduled"},  # completed_on on a scheduled job
        {**ok, "completed": "2026-09-30"},  # finished before it started
    ):
        with pytest.raises(IntegrityError):
            _attempt(conn, JOB_SQL, params)


QUOTE_SQL = """
INSERT INTO quotes (job_id, reference, status, subtotal_pence, vat_pence, total_pence,
    deposit_pence, currency, issued_on, valid_until)
VALUES (:job, 'Q-9001', 'draft', 1000, 200, :total, :deposit, :currency, '2026-10-01', '2026-10-31')
"""


def test_quote_rules(conn: Connection) -> None:
    job = _one(conn, "SELECT id FROM jobs LIMIT 1")
    ok = {"job": job, "total": 1200, "deposit": 300, "currency": "GBP"}
    _attempt(conn, QUOTE_SQL, ok)  # control: no error
    for params in (
        {**ok, "total": 1300},
        {**ok, "deposit": 1300},
        {**ok, "currency": "EUR"},
    ):
        with pytest.raises(IntegrityError):
            _attempt(conn, QUOTE_SQL, params)


def test_review_fields_must_match_review_status(conn: Connection) -> None:
    with pytest.raises(IntegrityError):
        _attempt(
            conn,
            "UPDATE job_reports SET review_status = 'reviewed', reviewed_at = NULL, "
            "reviewed_by_id = NULL WHERE review_status = 'awaiting_review'",
            {},
        )


def test_user_email_must_be_lowercase_and_unique(conn: Connection) -> None:
    sql = "INSERT INTO users (email, full_name, role) VALUES (:email, 'X', 'painter')"
    with pytest.raises(IntegrityError):
        _attempt(conn, sql, {"email": "Mixed@Case.test"})
    with pytest.raises(IntegrityError):
        _attempt(conn, sql, {"email": "manager@jobproof.test"})


def test_foreign_keys_restrict_deletes(conn: Connection) -> None:
    with pytest.raises(IntegrityError):
        _attempt(conn, "DELETE FROM customers", {})
    with pytest.raises(IntegrityError):
        _attempt(conn, "DELETE FROM jobs", {})
