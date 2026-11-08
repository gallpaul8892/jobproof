import re
from collections.abc import Iterator

import pytest
from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine, make_url

from tests.conftest import TEST_DATABASE_URL, alembic_config, ensure_database

TABLES = {
    "users",
    "customers",
    "jobs",
    "quotes",
    "job_reports",
    "report_checklist_items",
    "report_photos",
    "invoices",
    "payments",
    "company_settings",
    "audit_events",
}
ENUMS = {
    "user_role": ["manager", "painter", "admin"],
    "customer_type": ["homeowner", "landlord", "business"],
    "job_type": [
        "interior_repaint",
        "exterior_repaint",
        "wallpapering",
        "kitchen_cabinet_spray",
        "staircase_woodwork",
        "commercial_unit",
    ],
    "job_status": ["scheduled", "in_progress", "completed", "cancelled"],
    "quote_status": ["draft", "sent", "accepted", "declined", "expired"],
    "review_status": ["awaiting_review", "reviewed"],
    "photo_stage": ["before", "during", "after"],
    "invoice_state": ["draft", "issued", "void"],
    "payment_kind": ["deposit", "invoice"],
    "payment_method": ["card", "bank_transfer", "cash"],
    "audit_action": ["report.reviewed", "report.reopened", "report.edited", "settings.changed"],
    "audit_entity": ["report", "settings"],
}
SCRATCH = make_url(TEST_DATABASE_URL).set(database="jobproof_migrations_scratch")


@pytest.fixture(scope="module")
def scratch_engine() -> Iterator[Engine]:
    url = SCRATCH.render_as_string(hide_password=False)
    ensure_database(url)
    command.upgrade(alembic_config(url), "base")  # no-op on a fresh database
    command.downgrade(alembic_config(url), "base")
    command.upgrade(alembic_config(url), "head")
    engine = create_engine(url)
    yield engine
    engine.dispose()


def test_upgrade_downgrade_upgrade_and_no_drift() -> None:
    url = SCRATCH.render_as_string(hide_password=False)
    ensure_database(url)
    config = alembic_config(url)
    command.upgrade(config, "head")
    command.downgrade(config, "base")
    engine = create_engine(url)
    with engine.connect() as connection:
        left = connection.execute(
            text("SELECT count(*) FROM pg_type WHERE typname = ANY(:names)"),
            {"names": list(ENUMS)},
        ).scalar()
        tables = set(inspect(connection).get_table_names())
    engine.dispose()
    assert left == 0, "downgrade must drop the enum types"
    assert tables <= {"alembic_version"}
    command.upgrade(config, "head")
    command.check(config)


def test_history_is_linear_with_one_head() -> None:
    script = ScriptDirectory.from_config(alembic_config(TEST_DATABASE_URL))
    assert script.get_heads() == ["0006"]
    assert [r.revision for r in script.walk_revisions()] == [
        "0006",
        "0005",
        "0004",
        "0003",
        "0002",
        "0001",
    ]


def test_schema_has_the_nine_tables_and_enums(scratch_engine: Engine) -> None:
    with scratch_engine.connect() as connection:
        assert set(inspect(connection).get_table_names()) >= TABLES
        rows = connection.execute(
            text(
                "SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) "
                "FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid GROUP BY t.typname"
            )
        ).all()
    assert {name: labels for name, labels in rows} == ENUMS


def test_constraints_indexes_and_naming_convention(scratch_engine: Engine) -> None:
    inspector = inspect(scratch_engine)
    for table in TABLES:
        pk = inspector.get_pk_constraint(table)
        assert pk["name"] == f"pk_{table}"
        for fk in inspector.get_foreign_keys(table):
            column = fk["constrained_columns"][0]
            assert fk["name"] == f"fk_{table}_{column}_{fk['referred_table']}"
            expected = "CASCADE" if table.startswith("report_") else "RESTRICT"
            assert (fk["options"].get("ondelete") or "").upper() == expected, (table, column)
        for ck in inspector.get_check_constraints(table):
            assert re.fullmatch(rf"ck_{table}_[a-z0-9_]+", ck["name"] or ""), ck

    indexes = {table: {ix["name"]: ix for ix in inspector.get_indexes(table)} for table in TABLES}
    assert indexes["users"]["uq_users_email"]["unique"]
    for name in (
        "ix_jobs_customer_id",
        "ix_jobs_painter_id",
        "ix_jobs_completed_on",
        "ix_quotes_job_id",
        "ix_job_reports_review_status",
        "ix_job_reports_submitted_at",
        "ix_report_photos_report_id_stage_taken_at",
        "ix_invoices_customer_id",
        "ix_invoices_issue_date",
        "ix_payments_invoice_id",
        "ix_customers_lower_name",
    ):
        assert any(name in table_indexes for table_indexes in indexes.values()), name
    partial = indexes["invoices"]["uq_invoices_job_id_not_void"]
    assert partial["unique"]
    assert "void" in partial["dialect_options"]["postgresql_where"]

    checks = {
        table: {c["name"] for c in inspector.get_check_constraints(table)} for table in TABLES
    }
    assert {
        "ck_invoices_total_matches_parts",
        "ck_invoices_dates_match_state",
        "ck_invoices_currency_gbp",
    } <= checks["invoices"]
    assert {"ck_payments_target_matches_kind", "ck_payments_currency_gbp"} <= checks["payments"]
    assert "ck_jobs_completed_on_matches_status" in checks["jobs"]
    assert "ck_job_reports_review_fields_match_status" in checks["job_reports"]
    uniques = {
        table: {u["name"] for u in inspector.get_unique_constraints(table)} for table in TABLES
    }
    assert "uq_jobs_reference" in uniques["jobs"]
    assert "uq_job_reports_job_id" in uniques["job_reports"]
    assert "uq_invoices_number" in uniques["invoices"]
    assert "uq_report_checklist_items_report_id" in uniques["report_checklist_items"]


def test_money_columns_are_integers_and_currency_is_char3(scratch_engine: Engine) -> None:
    inspector = inspect(scratch_engine)
    for table in ("quotes", "invoices", "payments"):
        for column in inspector.get_columns(table):
            if column["name"].endswith("_pence"):
                assert str(column["type"]) == "INTEGER", (table, column["name"])
            if column["name"] == "currency":
                assert str(column["type"]) == "CHAR(3)"


def test_admin_role_downgrade_is_refused_while_an_admin_exists_then_restores_the_enum() -> None:
    url = SCRATCH.render_as_string(hide_password=False)
    ensure_database(url)
    config = alembic_config(url)
    command.upgrade(config, "head")
    engine = create_engine(url)
    try:
        with engine.begin() as connection:
            connection.execute(
                text("INSERT INTO users (email, full_name, role) VALUES ('a@x.test', 'A', 'admin')")
            )
        with pytest.raises(RuntimeError, match="role 'admin'"):
            command.downgrade(config, "0002")
        with engine.begin() as connection:  # the refused downgrade changed nothing
            assert connection.execute(text("SELECT count(*) FROM users")).scalar() == 1
            connection.execute(text("DELETE FROM users"))
            connection.execute(
                text(
                    "INSERT INTO users (email, full_name, role) VALUES ('m@x.test', 'M', 'manager')"
                )
            )
        command.downgrade(config, "0002")
        with engine.connect() as connection:
            labels = connection.execute(
                text(
                    "SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) FROM pg_type t "
                    "JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typname = 'user_role'"
                )
            ).scalar()
            role = connection.execute(text("SELECT role::text FROM users")).scalar()
        assert labels == ["manager", "painter"] and role == "manager"
    finally:
        engine.dispose()
        command.downgrade(config, "base")
        command.upgrade(config, "head")


def test_package_2_migrations_keep_existing_rows_and_downgrade_cleanly() -> None:
    """0004 to 0006 on a database that already holds reports: every report becomes version 1."""
    from app.seed.dataset import build_dataset
    from tests.conftest import ANCHOR

    url = SCRATCH.render_as_string(hide_password=False)
    ensure_database(url)
    config = alembic_config(url)
    command.downgrade(config, "base")
    command.upgrade(config, "0003")
    engine = create_engine(url)
    try:
        # Load the seed with the 0003 schema: no versioning columns, no audit table yet.
        from sqlalchemy import insert

        from app.models import Base

        dataset = build_dataset(ANCHOR)
        legacy = {"manager_notes"}
        with engine.begin() as connection:
            for name, rows in dataset.tables():
                if not rows:
                    continue
                table = Base.metadata.tables[name]
                import dataclasses

                payload = [
                    {k: v for k, v in dataclasses.asdict(r).items() if k not in legacy}  # type: ignore[call-overload]
                    for r in rows
                ]
                connection.execute(insert(table).execution_options(), payload)
        command.upgrade(config, "head")
        with engine.connect() as connection:
            reports = connection.execute(text("SELECT count(*) FROM job_reports")).scalar()
            at_one = connection.execute(
                text(
                    "SELECT count(*) FROM job_reports WHERE version = 1 "
                    "AND last_changed_at IS NULL AND last_changed_by_id IS NULL "
                    "AND manager_notes IS NULL"
                )
            ).scalar()
            events = connection.execute(text("SELECT count(*) FROM audit_events")).scalar()
        assert reports == 60 and at_one == 60 and events == 0
        command.downgrade(config, "0003")
        with engine.connect() as connection:
            inspector = inspect(connection)
            columns = {c["name"] for c in inspector.get_columns("job_reports")}
            assert not columns & {
                "version",
                "last_changed_at",
                "last_changed_by_id",
                "manager_notes",
            }
            assert "audit_events" not in inspector.get_table_names()
            leftovers = connection.execute(
                text(
                    "SELECT (SELECT count(*) FROM pg_type WHERE typname IN "
                    "('audit_action', 'audit_entity')), "
                    "(SELECT count(*) FROM pg_proc WHERE proname LIKE 'audit_events_%')"
                )
            ).one()
            assert tuple(leftovers) == (0, 0)
            assert connection.execute(text("SELECT count(*) FROM job_reports")).scalar() == 60
        command.upgrade(config, "head")
        command.check(config)
        with engine.connect() as connection:
            assert (
                connection.execute(
                    text("SELECT count(*) FROM job_reports WHERE version = 1")
                ).scalar()
                == 60
            )
    finally:
        # The scratch database holds seed users (including an admin), which a downgrade to base
        # refuses to drop: wipe it and rebuild an empty head schema for the other tests.
        with engine.begin() as connection:
            connection.execute(text("DROP SCHEMA public CASCADE"))
            connection.execute(text("CREATE SCHEMA public"))
        engine.dispose()
        command.upgrade(config, "head")


def test_version_and_last_changed_constraints(db_engine: Engine) -> None:
    from sqlalchemy.exc import IntegrityError

    with db_engine.connect() as connection:
        for assignment in (
            "version = 0",
            "version = -3",
            "last_changed_at = now()",
            "last_changed_by_id = (SELECT id FROM users LIMIT 1)",
        ):
            transaction = connection.begin()
            with pytest.raises(IntegrityError):
                connection.execute(text(f"UPDATE job_reports SET {assignment}"))  # noqa: S608
            transaction.rollback()
