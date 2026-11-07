"""Scenarios 3 and 4 against the real database (seeded once by the session fixture)."""

import dataclasses
import os
from collections import Counter
from collections.abc import Iterator
from datetime import date
from typing import Any

import pytest
from argon2 import PasswordHasher
from sqlalchemy import Engine, create_engine, text

from app.models import Base
from app.seed.__main__ import main
from app.seed.dataset import build_dataset
from app.seed.loader import load
from app.services.billing import InvoiceStatus
from tests.conftest import TEST_DATABASE_URL
from tests.dataset_checks import invoice_statuses
from tests.expected import NON_USER_TABLES_CHECKSUM_2026_11_07, non_user_tables_checksum

ANCHOR = date.fromisoformat(os.environ["SEED_ANCHOR_DATE"])


@pytest.fixture(scope="module")
def engine() -> Iterator[Engine]:
    engine = create_engine(TEST_DATABASE_URL)
    yield engine
    engine.dispose()


def _scalar(engine: Engine, sql: str) -> Any:
    with engine.connect() as connection:
        return connection.execute(text(sql)).scalar()


def _snapshot(engine: Engine) -> dict[str, list[tuple[Any, ...]]]:
    snapshot = {}
    with engine.connect() as connection:
        for name, table in Base.metadata.tables.items():
            columns = ", ".join(c.name for c in table.columns)
            rows = connection.execute(text(f"SELECT {columns} FROM {name} ORDER BY id"))  # noqa: S608
            snapshot[name] = [tuple(row) for row in rows]
    return snapshot


def test_seed_loads_the_specified_volumes(engine: Engine) -> None:
    counts = {
        table: _scalar(engine, f"SELECT count(*) FROM {table}")  # noqa: S608
        for table in Base.metadata.tables
    }
    assert counts["users"] == 9
    assert _scalar(engine, "SELECT count(*) FROM users WHERE role = 'manager'") == 2
    assert _scalar(engine, "SELECT count(*) FROM users WHERE role = 'painter'") == 6
    assert _scalar(engine, "SELECT count(*) FROM users WHERE role = 'admin'") == 1
    with engine.connect() as connection:
        hashed = {
            r[0]
            for r in connection.execute(
                text("SELECT email FROM users WHERE password_hash IS NOT NULL")
            )
        }
    assert hashed == {
        "manager@jobproof.test",
        "manager2@jobproof.test",
        "painter@jobproof.test",
        "admin@jobproof.test",
    }
    assert counts["customers"] == 12
    with engine.connect() as connection:
        types = dict(
            connection.execute(
                text("SELECT customer_type::text, count(*) FROM customers GROUP BY 1")
            ).all()
        )
    assert types == {"homeowner": 8, "landlord": 2, "business": 2}
    assert counts["jobs"] == 60 and counts["job_reports"] == 60
    assert (
        _scalar(engine, "SELECT count(*) FROM job_reports WHERE review_status = 'awaiting_review'")
        == 9
    )
    assert (
        _scalar(
            engine,
            "SELECT min(n) FROM "
            "(SELECT count(*) n FROM report_checklist_items GROUP BY report_id) x",
        )
        >= 5
    )
    assert (
        _scalar(
            engine,
            "SELECT max(n) FROM "
            "(SELECT count(*) n FROM report_checklist_items GROUP BY report_id) x",
        )
        <= 8
    )
    per_report = Counter(
        dict(
            tuple(r)
            for r in _rows(
                engine, "SELECT report_id, count(*) FROM report_photos GROUP BY report_id"
            )
        ).values()
    )
    assert sum(per_report.values()) == 59
    assert all(4 <= n <= 10 for n in per_report)
    assert counts["quotes"] == 24
    assert _scalar(engine, "SELECT count(*) FROM payments WHERE kind = 'deposit'") == 14
    assert counts["invoices"] == 52


def _rows(engine: Engine, sql: str) -> list[Any]:
    with engine.connect() as connection:
        return list(connection.execute(text(sql)).all())


def test_database_invoice_statuses_match_the_dataset(engine: Engine) -> None:
    expected = Counter(invoice_statuses(build_dataset(ANCHOR), ANCHOR).values())
    assert expected == {
        InvoiceStatus.draft: 6,
        InvoiceStatus.sent: 7,
        InvoiceStatus.part_paid: 2,
        InvoiceStatus.overdue: 6,
        InvoiceStatus.paid: 30,
        InvoiceStatus.void: 1,
    }
    rows = _rows(
        engine,
        """
        SELECT CASE
                 WHEN i.state = 'void' THEN 'void'
                 WHEN i.state = 'draft' THEN 'draft'
                 WHEN i.total_pence - COALESCE(p.paid, 0) <= 0 THEN 'paid'
                 WHEN i.due_date < :today THEN 'overdue'
                 WHEN COALESCE(p.paid, 0) > 0 THEN 'part_paid'
                 ELSE 'sent' END AS status, count(*)
        FROM invoices i
        LEFT JOIN (SELECT invoice_id, sum(amount_pence) paid FROM payments
                   WHERE invoice_id IS NOT NULL GROUP BY invoice_id) p ON p.invoice_id = i.id
        GROUP BY 1
        """.replace(":today", f"DATE '{ANCHOR.isoformat()}'"),
    )
    assert {InvoiceStatus(status): n for status, n in rows} == expected
    assert (
        _scalar(
            engine,
            "SELECT count(*) FROM jobs j "
            "WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.job_id = j.id)",
        )
        == 8
    )


def test_seeded_password_hashes_verify(engine: Engine) -> None:
    hasher = PasswordHasher()
    for email, password in (
        ("manager@jobproof.test", "Manager123!"),
        ("painter@jobproof.test", "Painter123!"),
        ("manager2@jobproof.test", "Manager123!"),
        ("admin@jobproof.test", "Admin123!"),
    ):
        stored = _scalar(engine, f"SELECT password_hash FROM users WHERE email = '{email}'")  # noqa: S608
        assert stored.startswith("$argon2id$")
        assert hasher.verify(stored, password)
    with pytest.raises(Exception, match="not match|Verif"):
        hasher.verify(
            _scalar(
                engine, "SELECT password_hash FROM users WHERE email = 'manager@jobproof.test'"
            ),
            "wrong",
        )


def test_seed_is_idempotent(engine: Engine) -> None:
    before = _snapshot(engine)
    main()
    main()
    after = _snapshot(engine)
    assert after == before
    assert sum(len(rows) for rows in before.values()) > 700


def test_database_rows_equal_the_dataset(engine: Engine) -> None:
    dataset = build_dataset(ANCHOR)
    snapshot = _snapshot(engine)
    for name, rows in dataset.tables():
        expected = sorted(dataclasses.astuple(row)[0] for row in rows)  # type: ignore[call-overload]
        assert sorted(r[0] for r in snapshot[name]) == expected, name


def test_loader_replaces_existing_data(engine: Engine) -> None:
    other = build_dataset(date(2026, 11, 1))
    load(engine, other)
    assert _scalar(engine, "SELECT max(completed_on) FROM jobs") <= date(2026, 11, 1)
    load(engine, build_dataset(ANCHOR))  # restore for the other tests
    assert _scalar(engine, "SELECT count(*) FROM jobs") == 60


@pytest.mark.parametrize("env", ["staging", "production"])
def test_seed_refuses_outside_local_and_test(
    env: str, monkeypatch: pytest.MonkeyPatch, engine: Engine
) -> None:
    """Exits non-zero before touching the database (the engine is never even created)."""
    import app.seed.__main__ as seed_main
    from app.config import get_settings

    before = _snapshot(engine)
    refused = get_settings().model_copy(update={"app_env": env})
    monkeypatch.setattr(seed_main, "get_settings", lambda: refused)

    def forbidden(*_: object) -> None:
        raise AssertionError("database touched")

    monkeypatch.setattr(seed_main, "make_engine", forbidden)
    monkeypatch.setattr(seed_main, "load", forbidden)
    with pytest.raises(SystemExit) as exit_info:
        seed_main.main()
    assert exit_info.value.code != 0
    assert "Refusing to seed" in str(exit_info.value.code)
    assert _snapshot(engine) == before


def test_seed_leaves_the_company_settings_row_alone(engine: Engine) -> None:
    sql = "SELECT id, company_name, theme_primary, created_at, updated_at FROM company_settings"
    before = _rows(engine, sql)
    assert len(before) == 1
    main()
    assert _rows(engine, sql) == before
    assert "company_settings" not in {name for name, _ in build_dataset(ANCHOR).tables()}


def test_adding_users_changed_no_other_table() -> None:
    ds = build_dataset(date(2026, 11, 7))
    assert non_user_tables_checksum(ds) == NON_USER_TABLES_CHECKSUM_2026_11_07


def test_new_users_have_stable_ids_and_are_appended_last() -> None:
    ds = build_dataset(ANCHOR)
    assert [u.email for u in ds.users][-2:] == ["manager2@jobproof.test", "admin@jobproof.test"]
    painter_ids = {u.id for u in ds.users if u.role.value == "painter"}
    assert {j.painter_id for j in ds.jobs} == painter_ids
