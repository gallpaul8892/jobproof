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
    "audit_action": [
        "report.reviewed",
        "report.reopened",
        "report.edited",
        "settings.changed",
        "customer.edited",
    ],
    "audit_entity": ["report", "settings", "customer"],
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
    assert script.get_heads() == ["0008"]
    assert [r.revision for r in script.walk_revisions()] == [
        "0008",
        "0007",
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


def test_0007_adds_customer_versioning_and_audit_links(scratch_engine: Engine) -> None:
    inspector = inspect(scratch_engine)
    columns = {c["name"]: c for c in inspector.get_columns("customers")}
    assert str(columns["version"]["type"]) == "INTEGER" and not columns["version"]["nullable"]
    assert "1" in str(columns["version"]["default"])
    assert columns["last_changed_at"]["nullable"] and columns["last_changed_by_id"]["nullable"]
    assert {
        "ck_customers_version_positive",
        "ck_customers_last_changed_fields_together",
    } <= {c["name"] for c in inspector.get_check_constraints("customers")}
    fks = {fk["name"]: fk for fk in inspector.get_foreign_keys("customers")}
    assert fks["fk_customers_last_changed_by_id_users"]["referred_table"] == "users"
    audit_columns = {c["name"]: c for c in inspector.get_columns("audit_events")}
    assert audit_columns["customer_id"]["nullable"]
    audit_fks = {fk["name"]: fk for fk in inspector.get_foreign_keys("audit_events")}
    customer_fk = audit_fks["fk_audit_events_customer_id_customers"]
    assert customer_fk["referred_table"] == "customers"
    assert (customer_fk["options"].get("ondelete") or "").upper() == "RESTRICT"
    assert "ck_audit_events_customer_id_matches_entity" in {
        c["name"] for c in inspector.get_check_constraints("audit_events")
    }
    index = next(
        ix
        for ix in inspector.get_indexes("audit_events")
        if ix["name"] == "ix_audit_events_customer_id_seq"
    )
    assert index["column_names"][0] == "customer_id"
    # the older settings index and report check survive
    names = {ix["name"] for ix in inspector.get_indexes("audit_events")}
    assert {"ix_audit_events_report_id_seq", "ix_audit_events_settings_seq"} <= names
    assert "ck_audit_events_report_id_matches_entity" in {
        c["name"] for c in inspector.get_check_constraints("audit_events")
    }


def test_0007_constraints_reject_bad_customer_rows(db_engine: Engine) -> None:
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
                connection.execute(text(f"UPDATE customers SET {assignment}"))  # noqa: S608
            transaction.rollback()


def test_0007_upgrade_keeps_existing_customers_and_downgrade_restores_the_enums() -> None:
    """Customers present before 0007 become version 1; downgrade and upgrade round-trip."""
    from sqlalchemy import insert

    from app.models import Base
    from app.seed.dataset import build_dataset
    from tests.conftest import ANCHOR

    url = SCRATCH.render_as_string(hide_password=False)
    ensure_database(url)
    config = alembic_config(url)
    command.downgrade(config, "base")
    command.upgrade(config, "0006")
    engine = create_engine(url)
    try:
        import dataclasses

        dataset = build_dataset(ANCHOR)
        with engine.begin() as connection:
            for name, rows in dataset.tables():
                if rows:
                    payload = [dataclasses.asdict(r) for r in rows]  # type: ignore[call-overload]
                    connection.execute(insert(Base.metadata.tables[name]), payload)
        command.upgrade(config, "0007")
        with engine.connect() as connection:
            total, at_one = connection.execute(
                text(
                    "SELECT count(*), count(*) FILTER (WHERE version = 1 "
                    "AND last_changed_at IS NULL AND last_changed_by_id IS NULL) FROM customers"
                )
            ).one()
            assert total == len(dataset.customers) == at_one
            labels = connection.execute(
                text(
                    "SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) "
                    "FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid "
                    "WHERE t.typname IN ('audit_action', 'audit_entity') GROUP BY t.typname"
                )
            ).all()
            assert dict(labels) == {
                "audit_action": ENUMS["audit_action"],
                "audit_entity": ENUMS["audit_entity"],
            }
        # a report event written at 0007 survives a round trip through 0006
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO audit_events (occurred_at, actor_id, actor_name, action, "
                    "entity_type, report_id, changes) SELECT now(), u.id, 'x', 'report.edited', "
                    "'report', (SELECT id FROM job_reports LIMIT 1), '[]'::jsonb "
                    "FROM users u WHERE role = 'manager' LIMIT 1"
                )
            )
        command.downgrade(config, "0006")
        with engine.connect() as connection:
            inspector = inspect(connection)
            assert not {"version", "last_changed_at", "last_changed_by_id"} & {
                c["name"] for c in inspector.get_columns("customers")
            }
            assert "customer_id" not in {c["name"] for c in inspector.get_columns("audit_events")}
            assert "ix_audit_events_customer_id_seq" not in {
                ix["name"] for ix in inspector.get_indexes("audit_events")
            }
            labels = connection.execute(
                text(
                    "SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) "
                    "FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid "
                    "WHERE t.typname IN ('audit_action', 'audit_entity') GROUP BY t.typname"
                )
            ).all()
            assert dict(labels) == {
                "audit_action": [
                    "report.reviewed",
                    "report.reopened",
                    "report.edited",
                    "settings.changed",
                ],
                "audit_entity": ["report", "settings"],
            }
            assert connection.execute(text("SELECT count(*) FROM audit_events")).scalar() == 1
            assert connection.execute(text("SELECT count(*) FROM customers")).scalar() == len(
                dataset.customers
            )
        # the append-only triggers still guard the table after the enum swap
        from sqlalchemy.exc import DBAPIError

        with pytest.raises(DBAPIError), engine.begin() as connection:
            connection.execute(text("DELETE FROM audit_events"))
        command.upgrade(config, "head")
        command.check(config)
    finally:
        with engine.begin() as connection:
            connection.execute(text("DROP SCHEMA public CASCADE"))
            connection.execute(text("CREATE SCHEMA public"))
        engine.dispose()
        command.upgrade(config, "head")


def test_0007_downgrade_is_refused_while_a_customer_event_exists() -> None:
    url = SCRATCH.render_as_string(hide_password=False)
    ensure_database(url)
    config = alembic_config(url)
    command.upgrade(config, "head")
    engine = create_engine(url)
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO users (email, full_name, role) VALUES ('m@x.test', 'M', 'manager')"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO customers (customer_type, name, billing_line1, billing_town, "
                    "billing_postcode, payment_terms_days) VALUES ('homeowner', 'C', '1 A St', "
                    "'Bath', 'BA1 1AA', 14)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO audit_events (occurred_at, actor_id, actor_name, action, "
                    "entity_type, customer_id, changes) SELECT now(), (SELECT id FROM users), 'M', "
                    "'customer.edited', 'customer', id, '[]'::jsonb FROM customers"
                )
            )
        with pytest.raises(RuntimeError, match=r"1 customer\.edited"):
            command.downgrade(config, "0006")
        with engine.connect() as connection:  # the refused downgrade changed nothing
            assert connection.execute(text("SELECT count(*) FROM audit_events")).scalar() == 1
            assert "customer_id" in {
                c["name"] for c in inspect(connection).get_columns("audit_events")
            }
            assert (
                connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
                == "0008"
            )
    finally:
        with engine.begin() as connection:
            connection.execute(text("DROP SCHEMA public CASCADE"))
            connection.execute(text("CREATE SCHEMA public"))
        engine.dispose()
        command.upgrade(config, "head")


def test_0008_adds_the_uk_only_flag_defaulting_to_true_and_downgrades() -> None:
    url = SCRATCH.render_as_string(hide_password=False)
    ensure_database(url)
    config = alembic_config(url)
    command.downgrade(config, "base")
    command.upgrade(config, "0007")
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            assert "uk_only_contact_details" not in {
                c["name"] for c in inspect(connection).get_columns("company_settings")
            }
        command.upgrade(config, "0008")
        with engine.connect() as connection:
            # the existing settings row (made by 0002) becomes TRUE, the strict default
            assert (
                connection.execute(
                    text("SELECT uk_only_contact_details FROM company_settings")
                ).scalar_one()
                is True
            )
        command.downgrade(config, "0007")
        with engine.connect() as connection:
            assert "uk_only_contact_details" not in {
                c["name"] for c in inspect(connection).get_columns("company_settings")
            }
        command.upgrade(config, "head")
        command.check(config)
    finally:
        with engine.begin() as connection:
            connection.execute(text("DROP SCHEMA public CASCADE"))
            connection.execute(text("CREATE SCHEMA public"))
        engine.dispose()
        command.upgrade(config, "head")
