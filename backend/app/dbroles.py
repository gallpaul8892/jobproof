"""Database roles and grants (B11, INFRA spec 5.4).

Three identities in AWS: the RDS master (used only by `db-roles`), `jobproof_migrator` (owns the
schema, runs `migrate`) and `jobproof_app` (what the API connects as). The app role has DML on
business tables, only SELECT and INSERT on `audit_events`, no TRUNCATE anywhere, owns nothing.
Everything here is idempotent.
"""

from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Connection, create_engine, text
from sqlalchemy.pool import NullPool

MIGRATOR_ROLE = "jobproof_migrator"
APP_ROLE = "jobproof_app"
MIN_ROLE_PASSWORD = 16

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_ROLE_ATTRIBUTES = "LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"


class RoleError(RuntimeError):
    """A precondition for the role commands is not met (message is safe to print)."""


def _run(connection: Connection, template: str, *args: str) -> None:
    """Run a statement built server-side with format(): %I quotes identifiers, %L literals."""
    statement = connection.execute(
        text("SELECT format(:template, VARIADIC CAST(:args AS text[]))"),
        {"template": template, "args": list(args)},
    ).scalar_one()
    # Straight to the driver with no parameters: SQLAlchemy would pass an empty dict, which makes
    # psycopg treat a "%" in a password as a placeholder. Same connection, same transaction.
    raw = connection.connection.dbapi_connection
    assert raw is not None  # noqa: S101 - the connection is open
    raw.execute(statement)


def _role_exists(connection: Connection, role: str) -> bool:
    return (
        connection.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": role}).first()
        is not None
    )


def current_user(connection: Connection) -> str:
    return str(connection.execute(text("SELECT current_user")).scalar_one())


def ensure_roles(connection: Connection, migrator_password: str, app_password: str) -> None:
    """Create or update the two login roles and give the migrator the schema (as master)."""
    for role, password in ((MIGRATOR_ROLE, migrator_password), (APP_ROLE, app_password)):
        if len(password) < MIN_ROLE_PASSWORD:
            raise RoleError(f"The {role} password must be at least {MIN_ROLE_PASSWORD} characters.")
        verb = "ALTER" if _role_exists(connection, role) else "CREATE"
        _run(connection, f"{verb} ROLE %I WITH {_ROLE_ATTRIBUTES} PASSWORD %L", role, password)
    # RDS's master is not a superuser, so it needs SET on the new owner to hand the schema over.
    _run(connection, "GRANT %I TO CURRENT_USER WITH SET TRUE", MIGRATOR_ROLE)
    database = str(connection.execute(text("SELECT current_database()")).scalar_one())
    _run(connection, "GRANT CONNECT ON DATABASE %I TO %I, %I", database, MIGRATOR_ROLE, APP_ROLE)
    _run(connection, "ALTER SCHEMA public OWNER TO %I", MIGRATOR_ROLE)
    _run(connection, "GRANT USAGE ON SCHEMA public TO %I", APP_ROLE)
    _run(connection, "REVOKE CREATE ON SCHEMA public FROM %I", APP_ROLE)


def apply_grants(connection: Connection) -> None:
    """Reset the app role's table privileges to the intended set (run after every migration).

    REVOKE ALL first, so drift (for example a privilege added by hand) is removed too.
    """
    _run(connection, "GRANT USAGE ON SCHEMA public TO %I", APP_ROLE)
    _run(connection, "REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I", APP_ROLE)
    _run(connection, "REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I", APP_ROLE)
    _run(
        connection,
        "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I",
        APP_ROLE,
    )
    # Append-only evidence: the app may read and add events, never change or remove them.
    _run(connection, "REVOKE ALL ON TABLE public.audit_events FROM %I", APP_ROLE)
    _run(connection, "GRANT SELECT, INSERT ON TABLE public.audit_events TO %I", APP_ROLE)
    # The app never needs to see the migration bookkeeping.
    _run(connection, "REVOKE ALL ON TABLE public.alembic_version FROM %I", APP_ROLE)
    _run(connection, "GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO %I", APP_ROLE)


def alembic_config(url: str) -> Config:
    config = Config(str(_BACKEND_DIR / "alembic.ini"))
    config.attributes["url"] = url
    return config


def head_revision() -> str:
    head = ScriptDirectory.from_config(alembic_config("")).get_current_head()
    assert head is not None  # noqa: S101 - the chain is never empty
    return head


def migrate(url: str, *, require_migrator: bool) -> str:
    """alembic upgrade head, then the grants, as the connecting role. Returns the head revision."""
    engine = create_engine(url, poolclass=NullPool, connect_args={"connect_timeout": 10})
    try:
        with engine.connect() as connection:
            user = current_user(connection)
            if require_migrator and user != MIGRATOR_ROLE:
                raise RoleError(f"migrate must run as {MIGRATOR_ROLE}, not {user}.")
            # Checked before any DDL, so a missing `db-roles` cannot leave a half-applied deploy.
            if not _role_exists(connection, APP_ROLE):
                raise RoleError(f"The role {APP_ROLE} does not exist; run db-roles first.")
        command.upgrade(alembic_config(url), "head")
        with engine.begin() as connection:
            apply_grants(connection)
    finally:
        engine.dispose()
    return head_revision()
