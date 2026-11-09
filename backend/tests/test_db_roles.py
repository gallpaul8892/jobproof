"""B11 (INFRA spec 5.4): migrator and app roles, grants, append-only audit for the app role."""

import json
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError, ProgrammingError

from app import cli, dbroles
from app.config import get_settings
from app.main import create_app
from tests.conftest import (
    B11_APP_PASSWORD,
    B11_MIGRATOR_PASSWORD,
    MANAGER_LOGIN,
    B11Database,
    bearer,
)

PRIVILEGES = ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER")


@pytest.fixture
def app_engine(b11: B11Database) -> Iterator[Engine]:
    engine = create_engine(b11.app)
    yield engine
    engine.dispose()


@pytest.fixture
def super_engine(b11: B11Database) -> Iterator[Engine]:
    engine = create_engine(b11.superuser)
    yield engine
    engine.dispose()


def _tables(engine: Engine) -> list[str]:
    with engine.connect() as connection:
        rows = connection.execute(
            text("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")
        )
        return [row[0] for row in rows]


def _privileges(engine: Engine, table: str) -> set[str]:
    with engine.connect() as connection:
        return {
            p
            for p in PRIVILEGES
            if connection.execute(
                text("SELECT has_table_privilege(:role, :table, :priv)"),
                {"role": dbroles.APP_ROLE, "table": f"public.{table}", "priv": p},
            ).scalar_one()
        }


def test_roles_are_plain_login_roles(super_engine: Engine) -> None:
    with super_engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, "
                "rolreplication, rolbypassrls FROM pg_roles WHERE rolname IN (:m, :a)"
            ),
            {"m": dbroles.MIGRATOR_ROLE, "a": dbroles.APP_ROLE},
        ).all()
    assert {r.rolname for r in rows} == {dbroles.MIGRATOR_ROLE, dbroles.APP_ROLE}
    for row in rows:
        assert row.rolcanlogin
        assert not any([row.rolsuper, row.rolcreatedb, row.rolcreaterole, row.rolreplication])
        assert not row.rolbypassrls


def test_migrator_owns_the_schema_and_everything_in_it(super_engine: Engine) -> None:
    with super_engine.connect() as connection:
        owners = {
            row[0]
            for row in connection.execute(
                text("SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'public'")
            )
        }
        schema_owner = connection.execute(
            text("SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname = 'public'")
        ).scalar_one()
        functions = {
            row[0]
            for row in connection.execute(
                text(
                    "SELECT proowner::regrole::text FROM pg_proc "
                    "WHERE pronamespace = 'public'::regnamespace"
                )
            )
        }
    assert owners == {dbroles.MIGRATOR_ROLE}
    assert schema_owner == dbroles.MIGRATOR_ROLE
    assert functions == {dbroles.MIGRATOR_ROLE}  # the append-only trigger functions


def test_app_role_owns_nothing(super_engine: Engine) -> None:
    with super_engine.connect() as connection:
        owned = connection.execute(
            text(
                "SELECT count(*) FROM pg_depend d JOIN pg_roles r ON r.rolname = :app "
                "WHERE d.refclassid = 'pg_authid'::regclass AND d.refobjid = r.oid "
                "AND d.deptype = 'o'"
            ),
            {"app": dbroles.APP_ROLE},
        ).scalar_one()
        shared = connection.execute(
            text(
                "SELECT count(*) FROM pg_shdepend s JOIN pg_roles r ON r.oid = s.refobjid "
                "WHERE r.rolname = :app AND s.deptype = 'o'"
            ),
            {"app": dbroles.APP_ROLE},
        ).scalar_one()
    assert owned == 0 and shared == 0


def test_app_role_has_no_truncate_anywhere_and_no_ddl_privileges(super_engine: Engine) -> None:
    for table in _tables(super_engine):
        granted = _privileges(super_engine, table)
        assert "TRUNCATE" not in granted, table
        assert "REFERENCES" not in granted and "TRIGGER" not in granted, table


def test_app_role_has_only_select_and_insert_on_audit_events(super_engine: Engine) -> None:
    assert _privileges(super_engine, "audit_events") == {"SELECT", "INSERT"}


def test_app_role_has_dml_on_every_business_table(super_engine: Engine) -> None:
    for table in _tables(super_engine):
        if table in ("audit_events", "alembic_version"):
            continue
        assert _privileges(super_engine, table) == {"SELECT", "INSERT", "UPDATE", "DELETE"}, table
    assert _privileges(super_engine, "alembic_version") == set()


def test_app_role_cannot_create_objects(app_engine: Engine) -> None:
    with pytest.raises(ProgrammingError, match="permission denied"), app_engine.begin() as c:
        c.execute(text("CREATE TABLE sneaky (id int)"))


@pytest.mark.parametrize("table", ["audit_events", "users", "job_reports"])
def test_truncate_is_refused_for_the_app_role(app_engine: Engine, table: str) -> None:
    with pytest.raises(ProgrammingError, match="permission denied"), app_engine.begin() as c:
        c.execute(text(f"TRUNCATE TABLE {table} CASCADE"))  # noqa: S608


def test_the_truncate_setting_is_useless_without_the_privilege(app_engine: Engine) -> None:
    """The jobproof.allow_audit_truncate escape hatch (any role can set it) cannot be used."""
    with pytest.raises(ProgrammingError, match="permission denied"), app_engine.begin() as c:
        c.execute(text("SET LOCAL jobproof.allow_audit_truncate = 'on'"))
        c.execute(text("TRUNCATE TABLE audit_events"))


@pytest.mark.parametrize(
    "statement", ["DELETE FROM audit_events", "UPDATE audit_events SET actor_name = 'x'"]
)
def test_audit_events_cannot_be_changed_or_removed_by_the_app_role(
    app_engine: Engine, statement: str
) -> None:
    with pytest.raises(ProgrammingError, match="permission denied"), app_engine.begin() as c:
        c.execute(text(statement))


def test_ordinary_app_operations_still_work(b11_reseeded: B11Database, app_engine: Engine) -> None:
    with app_engine.begin() as connection:
        assert connection.execute(text("SELECT count(*) FROM users")).scalar_one() > 0
        connection.execute(text("UPDATE company_settings SET company_name = company_name"))
        connection.execute(
            text(
                "UPDATE job_reports SET manager_notes = 'b11' "
                "WHERE id = (SELECT id FROM job_reports LIMIT 1)"
            )
        )
        actor = connection.execute(text("SELECT id FROM users LIMIT 1")).scalar_one()
        connection.execute(
            text(
                "INSERT INTO audit_events (occurred_at, actor_id, actor_name, action, entity_type) "
                "VALUES (now(), :a, 'B11', 'settings.changed', 'settings')"
            ),
            {"a": actor},
        )
        assert connection.execute(text("SELECT count(*) FROM audit_events")).scalar_one() >= 1
        connection.execute(text("DELETE FROM report_photos WHERE false"))


def test_the_api_works_end_to_end_as_the_app_role(b11_reseeded: B11Database) -> None:
    settings = get_settings().model_copy(update={"database_url": b11_reseeded.app_url})
    with TestClient(create_app(settings)) as client:
        assert client.get("/health").status_code == 200
        login = client.post(
            "/api/v1/auth/login", json={"email": MANAGER_LOGIN[0], "password": MANAGER_LOGIN[1]}
        )
        assert login.status_code == 200
        headers = bearer(login.json()["access_token"])
        listing = client.get("/api/v1/manager/reports", headers=headers)
        assert listing.status_code == 200
        report_id = listing.json()["items"][0]["id"]
        detail = client.get(f"/api/v1/manager/reports/{report_id}", headers=headers).json()
        # A write with its audit event (INSERT on audit_events) and a history read (SELECT).
        edited = client.patch(
            f"/api/v1/manager/reports/{report_id}",
            headers=headers,
            json={"version": detail["version"], "manager_notes": "Checked as the app role."},
        )
        assert edited.status_code == 200, edited.text
        history = client.get(f"/api/v1/manager/reports/{report_id}/history", headers=headers)
        assert history.status_code == 200
        assert any(e["action"] == "report.edited" for e in history.json()["items"])


def test_migrate_and_db_roles_are_idempotent(
    b11: B11Database, super_engine: Engine, master_engine: Engine
) -> None:
    before = {t: _privileges(super_engine, t) for t in _tables(super_engine)}
    with master_engine.begin() as connection:
        dbroles.ensure_roles(connection, B11_MIGRATOR_PASSWORD, B11_APP_PASSWORD)
    assert dbroles.migrate(b11.migrator_url, require_migrator=True) == dbroles.head_revision()
    assert {t: _privileges(super_engine, t) for t in _tables(super_engine)} == before
    engine = create_engine(b11.app)  # passwords still work
    with engine.connect() as connection:
        assert connection.execute(text("SELECT 1")).scalar_one() == 1
    engine.dispose()


@pytest.fixture
def master_engine(b11: B11Database) -> Iterator[Engine]:
    engine = create_engine(b11.master)
    yield engine
    engine.dispose()


def _can_log_in(url: Any) -> bool:
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            return connection.execute(text("SELECT 1")).scalar_one() == 1
    except OperationalError:
        return False
    finally:
        engine.dispose()


def test_the_master_is_not_a_superuser(b11: B11Database, super_engine: Engine) -> None:
    with super_engine.connect() as connection:
        row = connection.execute(
            text("SELECT rolsuper, rolcreaterole FROM pg_roles WHERE rolname = :r"),
            {"r": b11.master.username},
        ).one()
    assert (row.rolsuper, row.rolcreaterole) == (False, True)


def test_db_roles_as_the_non_superuser_master_rotates_passwords(
    b11: B11Database, master_engine: Engine
) -> None:
    """The RDS path: the second run takes the existing-roles branch and still succeeds."""
    new_migrator, new_app = "rotated-migrator-Pass-01", "rotated-app-Pass-%'-02"
    try:
        with master_engine.begin() as connection:
            dbroles.ensure_roles(connection, new_migrator, new_app)
        assert _can_log_in(b11.migrator.set(password=new_migrator))
        assert _can_log_in(b11.app.set(password=new_app))
        assert not _can_log_in(b11.migrator)  # the old passwords stopped working
        assert not _can_log_in(b11.app)
    finally:
        with master_engine.begin() as connection:
            dbroles.ensure_roles(connection, B11_MIGRATOR_PASSWORD, B11_APP_PASSWORD)
    assert _can_log_in(b11.migrator)
    assert _can_log_in(b11.app)
    assert dbroles.migrate(b11.migrator_url, require_migrator=True) == dbroles.head_revision()


def test_ensure_roles_refuses_an_existing_role_with_privileged_attributes(
    b11: B11Database, super_engine: Engine, master_engine: Engine
) -> None:
    with super_engine.begin() as connection:
        connection.execute(text(f"ALTER ROLE {dbroles.APP_ROLE} CREATEDB"))
    try:
        with (
            pytest.raises(dbroles.RoleError, match="privileged attributes"),
            master_engine.begin() as connection,
        ):
            dbroles.ensure_roles(connection, B11_MIGRATOR_PASSWORD, B11_APP_PASSWORD)
    finally:
        with super_engine.begin() as connection:
            connection.execute(text(f"ALTER ROLE {dbroles.APP_ROLE} NOCREATEDB"))


def test_passwords_are_stored_as_scram_and_never_sent_in_clear(
    b11: B11Database,
    super_engine: Engine,
    master_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    with super_engine.connect() as connection:
        stored = dict(
            connection.execute(
                text("SELECT rolname, rolpassword FROM pg_authid WHERE rolname IN (:m, :a)"),
                {"m": dbroles.MIGRATOR_ROLE, "a": dbroles.APP_ROLE},
            ).all()
        )
    assert set(stored) == {dbroles.MIGRATOR_ROLE, dbroles.APP_ROLE}
    for verifier in stored.values():
        assert verifier.startswith("SCRAM-SHA-256$")
    sent: list[str] = []

    def record(conn: Any, cursor: Any, statement: str, parameters: Any, *_: Any) -> None:
        sent.append(f"{statement} {parameters}")

    event.listen(master_engine, "before_cursor_execute", record)
    original_run = dbroles._run

    def recording_run(connection: Any, template: str, *args: str) -> None:
        sent.append(f"{template} {args}")
        original_run(connection, template, *args)

    monkeypatch.setattr(dbroles, "_run", recording_run)
    with caplog.at_level("DEBUG"), master_engine.begin() as connection:
        dbroles.ensure_roles(connection, B11_MIGRATOR_PASSWORD, B11_APP_PASSWORD)
    event.remove(master_engine, "before_cursor_execute", record)
    everything = "\n".join(sent) + caplog.text
    assert any("SCRAM-SHA-256$" in s for s in sent)
    assert B11_MIGRATOR_PASSWORD not in everything
    assert B11_APP_PASSWORD not in everything


def test_migrate_removes_privilege_drift(b11: B11Database, super_engine: Engine) -> None:
    with super_engine.begin() as connection:
        connection.execute(text("GRANT TRUNCATE, UPDATE ON audit_events TO jobproof_app"))
        connection.execute(text("GRANT TRUNCATE ON users TO jobproof_app"))
    assert "TRUNCATE" in _privileges(super_engine, "users")
    dbroles.migrate(b11.migrator_url, require_migrator=True)
    assert _privileges(super_engine, "audit_events") == {"SELECT", "INSERT"}
    assert "TRUNCATE" not in _privileges(super_engine, "users")


def test_migrate_refuses_to_run_as_another_role(b11: B11Database) -> None:
    with pytest.raises(dbroles.RoleError, match="must run as jobproof_migrator"):
        dbroles.migrate(b11.superuser_url, require_migrator=True)
    with pytest.raises(dbroles.RoleError, match="must run as jobproof_migrator"):
        dbroles.migrate(b11.app_url, require_migrator=True)


def test_migrate_checks_the_app_role_before_any_ddl(
    b11: B11Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(dbroles, "APP_ROLE", "jobproof_missing_role")
    with pytest.raises(dbroles.RoleError, match="run db-roles first"):
        dbroles.migrate(b11.migrator_url, require_migrator=True)


@pytest.mark.parametrize("password", ["", "short", "x" * 15])
def test_short_role_passwords_are_refused(super_engine: Engine, password: str) -> None:
    with pytest.raises(dbroles.RoleError, match="at least 16"), super_engine.begin() as connection:
        dbroles.ensure_roles(connection, password or "x", B11_APP_PASSWORD)


# ---- the commands ---------------------------------------------------------------------------


def _settings_for(url: str, **extra: Any) -> Any:
    return get_settings().model_copy(update={"database_url": url, **extra})


def test_cli_db_roles_and_migrate(
    b11: B11Database, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("DB_MIGRATOR_PASSWORD", B11_MIGRATOR_PASSWORD)
    monkeypatch.setenv("DB_APP_PASSWORD", B11_APP_PASSWORD)
    monkeypatch.setattr(cli, "get_settings", lambda: _settings_for(b11.superuser_url))
    assert cli.main(["db-roles"]) == 0
    out = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert out == {"event": "db_roles_ready", "roles": [dbroles.MIGRATOR_ROLE, dbroles.APP_ROLE]}

    monkeypatch.setattr(cli, "get_settings", lambda: _settings_for(b11.migrator_url))
    assert cli.main(["migrate"]) == 0
    out = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert out == {"event": "migrated", "revision": dbroles.head_revision()}


def test_cli_migrate_in_staging_needs_the_migrator(
    b11: B11Database, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(
        cli,
        "get_settings",
        lambda: _settings_for(b11.app_url, app_env="staging"),
    )
    assert cli.main(["migrate"]) == 2
    assert "must run as jobproof_migrator" in capsys.readouterr().err


def test_cli_db_roles_needs_both_passwords(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv("DB_MIGRATOR_PASSWORD", raising=False)
    monkeypatch.setenv("DB_APP_PASSWORD", B11_APP_PASSWORD)
    assert cli.main(["db-roles"]) == 2
    assert "DB_MIGRATOR_PASSWORD" in capsys.readouterr().err


def test_cli_db_roles_never_prints_passwords(
    b11: B11Database, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("DB_MIGRATOR_PASSWORD", B11_MIGRATOR_PASSWORD)
    monkeypatch.setenv("DB_APP_PASSWORD", B11_APP_PASSWORD)
    monkeypatch.setattr(cli, "get_settings", lambda: _settings_for(b11.superuser_url))
    cli.main(["db-roles"])
    captured = capsys.readouterr()
    assert B11_APP_PASSWORD not in captured.out + captured.err
    assert B11_MIGRATOR_PASSWORD not in captured.out + captured.err
