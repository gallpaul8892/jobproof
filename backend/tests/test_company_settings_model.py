"""T-002a scenarios 1, 2, 4 and 6 against the real database."""

from collections.abc import Iterator
from typing import Any

import pytest
from alembic import command
from sqlalchemy import Connection, create_engine, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import IntegrityError

from app.branding.defaults import DEFAULT_COMPANY_NAME, DEFAULT_THEME
from tests.conftest import TEST_DATABASE_URL, alembic_config, ensure_database

SCRATCH = make_url(TEST_DATABASE_URL).set(database="jobproof_settings_scratch")
SCRATCH_URL = SCRATCH.render_as_string(hide_password=False)
COLUMNS = (
    "company_name, theme_primary, theme_accent, theme_background, theme_surface, theme_text, "
    "updated_at, updated_by_id, updated_by_name"
)


@pytest.fixture
def scratch(monkeypatch: pytest.MonkeyPatch) -> Iterator[Engine]:
    """An empty database, migrated by the test itself, dropped back to base afterwards."""
    monkeypatch.delenv("DEFAULT_COMPANY_NAME", raising=False)
    ensure_database(SCRATCH_URL)
    command.downgrade(alembic_config(SCRATCH_URL), "base")
    engine = create_engine(SCRATCH_URL)
    yield engine
    engine.dispose()
    command.downgrade(alembic_config(SCRATCH_URL), "base")


@pytest.fixture
def conn(db_engine: Engine) -> Iterator[Connection]:
    """A connection on the real test database whose changes are always rolled back."""
    with db_engine.connect() as connection:
        transaction = connection.begin()
        yield connection
        transaction.rollback()


def _row(engine: Engine) -> Any:
    with engine.connect() as connection:
        return connection.execute(text(f"SELECT {COLUMNS} FROM company_settings")).one()  # noqa: S608


def test_migration_creates_one_default_row_and_seed_leaves_it_alone(scratch: Engine) -> None:
    command.upgrade(alembic_config(SCRATCH_URL), "head")
    row = _row(scratch)
    assert tuple(row)[:6] == (DEFAULT_COMPANY_NAME, *vars(DEFAULT_THEME).values())
    assert tuple(row)[6:] == (None, None, None)
    with scratch.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM company_settings")).scalar() == 1


def test_default_company_name_comes_from_the_environment(
    scratch: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("DEFAULT_COMPANY_NAME", "  Oakfield Joinery ")
    command.upgrade(alembic_config(SCRATCH_URL), "head")
    row = _row(scratch)
    assert row.company_name == "Oakfield Joinery"
    assert row.theme_primary == DEFAULT_THEME.primary


@pytest.mark.parametrize("value", ["x" * 61, "Bad\nName", "Bad\u0085Name"])
def test_a_bad_default_company_name_fails_the_migration(
    scratch: Engine, monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    monkeypatch.setenv("DEFAULT_COMPANY_NAME", value)
    with pytest.raises(RuntimeError, match="DEFAULT_COMPANY_NAME"):
        command.upgrade(alembic_config(SCRATCH_URL), "head")


def test_a_sixty_character_default_name_is_accepted(
    scratch: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("DEFAULT_COMPANY_NAME", "x" * 60)
    command.upgrade(alembic_config(SCRATCH_URL), "head")
    assert _row(scratch).company_name == "x" * 60


def test_downgrade_drops_the_table_and_upgrade_recreates_the_default_row(scratch: Engine) -> None:
    command.upgrade(alembic_config(SCRATCH_URL), "head")
    with scratch.begin() as connection:
        connection.execute(text("UPDATE company_settings SET company_name = 'Changed Ltd'"))
    command.downgrade(alembic_config(SCRATCH_URL), "0001")
    command.upgrade(alembic_config(SCRATCH_URL), "head")
    assert _row(scratch).company_name == DEFAULT_COMPANY_NAME  # downgrade drops, upgrade recreates


def test_only_one_row_can_exist(conn: Connection) -> None:
    insert = text(
        "INSERT INTO company_settings (id, company_name, theme_primary, theme_accent, "
        "theme_background, theme_surface, theme_text) "
        "VALUES (:id, 'X', '#111111', '#222222', '#333333', '#444444', '#555555')"
    )
    for row_id in (1, 2):
        with pytest.raises(IntegrityError), conn.begin_nested():
            conn.execute(insert, {"id": row_id})


@pytest.mark.parametrize("colour", ["green", "#12345", "#1f5130", "1F5130", "#GGGGGG"])
@pytest.mark.parametrize("column", ["theme_primary", "theme_accent", "theme_text"])
def test_theme_colours_must_be_upper_case_hex(conn: Connection, column: str, colour: str) -> None:
    with pytest.raises(IntegrityError), conn.begin_nested():
        conn.execute(text(f"UPDATE company_settings SET {column} = :c"), {"c": colour})  # noqa: S608


@pytest.mark.parametrize("name", ["", " ", " padded ", "x" * 61])
def test_company_name_must_be_trimmed_and_1_to_60_characters(conn: Connection, name: str) -> None:
    with pytest.raises(IntegrityError), conn.begin_nested():
        conn.execute(text("UPDATE company_settings SET company_name = :n"), {"n": name})


def test_updated_fields_are_all_set_or_all_null(conn: Connection) -> None:
    for assignment in (
        "updated_at = now()",
        "updated_by_id = gen_random_uuid()",
        "updated_at = now(), updated_by_id = gen_random_uuid()",
        "updated_by_name = 'Tom'",
    ):
        with pytest.raises(IntegrityError), conn.begin_nested():
            conn.execute(text(f"UPDATE company_settings SET {assignment}"))  # noqa: S608
    conn.execute(
        text(
            "UPDATE company_settings SET updated_at = now(), updated_by_id = gen_random_uuid(), "
            "updated_by_name = 'Tom Ashworth'"
        )
    )


def test_no_foreign_key_into_users_so_truncate_cascade_spares_the_row(conn: Connection) -> None:
    count = conn.execute(
        text(
            "SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid "
            "WHERE t.relname = 'company_settings' AND c.contype = 'f'"
        )
    ).scalar()
    assert count == 0


def test_truncating_users_cascade_does_not_touch_the_row(conn: Connection) -> None:
    # The cascade also reaches audit_events, whose guard trigger needs the seed's setting.
    conn.execute(text("SET LOCAL jobproof.allow_audit_truncate = 'on'"))
    conn.execute(text("TRUNCATE TABLE users CASCADE"))
    assert conn.execute(text("SELECT count(*) FROM company_settings")).scalar() == 1
