"""T-002f scenario 5: the database itself refuses to change or delete audit events."""

from collections.abc import Iterator
from typing import Any

import pytest
from sqlalchemy import Connection, Engine, create_engine, text
from sqlalchemy.exc import DBAPIError, IntegrityError, ProgrammingError

from tests.write_helpers import awaiting_reports

pytestmark = pytest.mark.usefixtures("reseed")


@pytest.fixture
def app_engine() -> Iterator[Engine]:
    """An engine built exactly like the application's: the app's own DATABASE_URL and role."""
    from app.config import get_settings

    engine = create_engine(get_settings().database_url)
    yield engine
    engine.dispose()


def _insert_event(connection: Connection, report_id: Any) -> None:
    connection.execute(
        text(
            "INSERT INTO audit_events (occurred_at, actor_id, actor_name, action, entity_type, "
            "report_id, changes) SELECT now(), id, full_name, 'report.edited', 'report', :r, "
            "'[]'::jsonb FROM users WHERE role = 'manager' LIMIT 1"
        ),
        {"r": report_id},
    )


@pytest.fixture
def one_event(app_engine: Engine, ds: Any) -> Any:
    report_id = awaiting_reports(ds)[0].id
    with app_engine.begin() as connection:
        _insert_event(connection, report_id)
    return report_id


def _sqlstate(error: DBAPIError) -> str | None:
    return getattr(error.orig, "sqlstate", None)


def _count(engine: Engine) -> int:
    with engine.connect() as connection:
        return int(connection.execute(text("SELECT count(*) FROM audit_events")).scalar_one())


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE audit_events SET actor_name = 'x'",
        "UPDATE audit_events SET changes = '[]'::jsonb",
        "UPDATE audit_events SET occurred_at = now()",
        "UPDATE audit_events SET report_id = NULL, entity_type = 'settings'",
        "DELETE FROM audit_events",
        "DELETE FROM audit_events WHERE true",
    ],
)
def test_update_and_delete_are_refused_for_the_application_role(
    app_engine: Engine, one_event: Any, statement: str
) -> None:
    with pytest.raises(ProgrammingError) as caught, app_engine.begin() as connection:
        connection.execute(text(statement))
    assert _sqlstate(caught.value) == "42501"
    assert "append-only" in str(caught.value)
    assert _count(app_engine) == 1


def test_truncate_is_refused_without_the_seed_setting(app_engine: Engine, one_event: Any) -> None:
    for statement in (
        "TRUNCATE audit_events",
        "TRUNCATE users CASCADE",
        "TRUNCATE job_reports CASCADE",
    ):
        with pytest.raises(ProgrammingError) as caught, app_engine.begin() as connection:
            connection.execute(text(statement))
        assert _sqlstate(caught.value) == "42501", statement
    assert _count(app_engine) == 1


def test_truncate_is_allowed_only_with_the_transaction_local_setting(
    app_engine: Engine, one_event: Any
) -> None:
    with app_engine.begin() as connection:
        connection.execute(text("SET LOCAL jobproof.allow_audit_truncate = 'on'"))
        connection.execute(text("TRUNCATE audit_events"))
    assert _count(app_engine) == 0
    # SET LOCAL ended with that transaction: the next one is guarded again.
    with app_engine.begin() as connection:
        _insert_event(connection, one_event)
    with pytest.raises(ProgrammingError), app_engine.begin() as connection:
        connection.execute(text("TRUNCATE audit_events"))
    # Other values do not open the door either.
    for value in ("off", "ON ", "true", ""):
        with pytest.raises(ProgrammingError), app_engine.begin() as connection:
            connection.execute(
                text("SELECT set_config('jobproof.allow_audit_truncate', :v, true)"), {"v": value}
            )
            connection.execute(text("TRUNCATE audit_events"))


def test_a_refused_statement_rolls_back_the_whole_transaction(
    app_engine: Engine, one_event: Any
) -> None:
    with pytest.raises(ProgrammingError), app_engine.begin() as connection:
        _insert_event(connection, one_event)
        connection.execute(text("DELETE FROM audit_events"))
    assert _count(app_engine) == 1


def test_inserts_work_and_seq_is_server_generated(app_engine: Engine, one_event: Any) -> None:
    with app_engine.begin() as connection:
        _insert_event(connection, one_event)
        _insert_event(connection, one_event)
    with app_engine.connect() as connection:
        seqs = connection.execute(text("SELECT seq FROM audit_events ORDER BY seq")).scalars().all()
    assert len(seqs) == 3 and seqs == sorted(set(seqs))
    with pytest.raises(DBAPIError), app_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO audit_events (seq, occurred_at, actor_id, actor_name, action, "
                "entity_type, changes) SELECT 1, now(), id, 'x', 'settings.changed', 'settings', "
                "'[]'::jsonb FROM users LIMIT 1"
            )
        )


def test_the_actor_and_report_cannot_be_deleted_while_events_exist(
    app_engine: Engine, one_event: Any
) -> None:
    with pytest.raises(IntegrityError), app_engine.begin() as connection:
        connection.execute(text("DELETE FROM job_reports WHERE id = :r"), {"r": one_event})
    with pytest.raises(IntegrityError), app_engine.begin() as connection:
        connection.execute(text("DELETE FROM users WHERE role = 'manager'"))
    assert _count(app_engine) == 1


@pytest.mark.parametrize(
    ("values", "reason"),
    [
        (
            "'settings.changed', 'settings', (SELECT id FROM job_reports LIMIT 1), '[]'",
            "report_id_matches",
        ),
        ("'report.edited', 'report', NULL, '[]'", "report_id_matches"),
        (
            "'report.edited', 'report', (SELECT id FROM job_reports LIMIT 1), '{}'",
            "changes_is_array",
        ),
        (
            "'report.edited', 'report', (SELECT id FROM job_reports LIMIT 1), '\"x\"'",
            "changes_is_array",
        ),
        ("'report.deleted', 'report', (SELECT id FROM job_reports LIMIT 1), '[]'", "audit_action"),
    ],
)
def test_malformed_events_are_refused(app_engine: Engine, values: str, reason: str) -> None:
    sql = (
        "INSERT INTO audit_events (occurred_at, actor_id, actor_name, action, entity_type, "  # noqa: S608
        f"report_id, changes) SELECT now(), id, 'n', {values} FROM users LIMIT 1"
    )
    with pytest.raises(DBAPIError) as caught, app_engine.begin() as connection:
        connection.execute(text(sql))
    assert reason in str(caught.value)


def test_the_triggers_exist_and_are_enabled(app_engine: Engine) -> None:
    with app_engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT tgname, tgenabled FROM pg_trigger "
                "WHERE tgrelid = 'audit_events'::regclass AND NOT tgisinternal ORDER BY tgname"
            )
        ).all()
    assert [tuple(r) for r in rows] == [
        ("audit_events_no_truncate", "O"),
        ("audit_events_no_update_delete", "O"),
    ]
