"""Operational commands (every APP_ENV; none of them is the seed).

    python -m app.cli create-user --role admin|manager --email EMAIL --full-name NAME
    python -m app.cli create-admin --email EMAIL --full-name NAME     (= create-user --role admin)
    python -m app.cli db-roles     create the migrator and app roles (as the RDS master; B11)
    python -m app.cli migrate      alembic upgrade head, then grants (as the migrator role)

The user's password comes from ADMIN_INITIAL_PASSWORD or, if unset, an interactive prompt (asked
twice). It is never echoed or logged; the output names only the new user's id.
db-roles reads DB_MIGRATOR_PASSWORD and DB_APP_PASSWORD (at least 16 characters).
"""

import argparse
import getpass
import json
import os
import sys

from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from app import dbroles
from app.config import get_settings
from app.db import make_engine
from app.models import User
from app.models.enums import UserRole
from app.schemas.text import contains_forbidden_character
from app.security import hash_password
from app.services.auth import normalise_email

MIN_PASSWORD = 12
MAX_PASSWORD = 200


def _password_problem(password: str) -> str | None:
    if len(password) < MIN_PASSWORD:
        return f"The password must be at least {MIN_PASSWORD} characters."
    if len(password) > MAX_PASSWORD:
        return f"The password must be at most {MAX_PASSWORD} characters."
    if "\x00" in password:
        return "The password must not contain NUL characters."
    return None


def _read_password() -> str:
    from_env = os.environ.get("ADMIN_INITIAL_PASSWORD")
    if from_env:
        return from_env
    first = getpass.getpass("Password: ")
    if getpass.getpass("Repeat password: ") != first:
        sys.exit("The passwords do not match.")
    return first


def create_user(email: str, full_name: str, role: UserRole, event: str) -> int:
    email = normalise_email(email)
    full_name = full_name.strip(" ")
    if not full_name or len(full_name) > 100 or contains_forbidden_character(full_name):
        print("Enter a full name of 1 to 100 characters.", file=sys.stderr)
        return 2
    if "@" not in email or len(email) > 254 or "\x00" in email:
        print("Enter a valid email address.", file=sys.stderr)
        return 2
    password = _read_password()
    problem = _password_problem(password)
    if problem:
        print(problem, file=sys.stderr)
        return 2
    engine = make_engine(get_settings().database_url)
    try:
        with Session(engine) as session:
            if session.scalar(select(User.id).where(User.email == email)) is not None:
                print("A user with that email already exists.", file=sys.stderr)
                return 1
            user = User(
                email=email,
                full_name=full_name,
                role=role,
                password_hash=hash_password(password),
                is_active=True,
            )
            session.add(user)
            try:
                session.commit()
            except IntegrityError:
                session.rollback()
                print("A user with that email already exists.", file=sys.stderr)
                return 1
            # One JSON line: the id only, no email, no password.
            print(json.dumps({"event": event, "user_id": str(user.id)}))
    finally:
        engine.dispose()
    return 0


def create_admin(email: str, full_name: str) -> int:
    return create_user(email, full_name, UserRole.admin, "admin_created")


def run_db_roles() -> int:
    migrator_password = os.environ.get("DB_MIGRATOR_PASSWORD", "")
    app_password = os.environ.get("DB_APP_PASSWORD", "")
    if not migrator_password or not app_password:
        print("Set DB_MIGRATOR_PASSWORD and DB_APP_PASSWORD.", file=sys.stderr)
        return 2
    engine = create_engine(
        get_settings().database_url, poolclass=NullPool, connect_args={"connect_timeout": 10}
    )
    try:
        with engine.begin() as connection:
            dbroles.ensure_roles(connection, migrator_password, app_password)
    except dbroles.RoleError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    finally:
        engine.dispose()
    roles = [dbroles.MIGRATOR_ROLE, dbroles.APP_ROLE]
    print(json.dumps({"event": "db_roles_ready", "roles": roles}))
    return 0


def run_migrate() -> int:
    settings = get_settings()
    strict = settings.app_env in ("staging", "production")
    try:
        revision = dbroles.migrate(settings.database_url, require_migrator=strict)
    except dbroles.RoleError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    print(json.dumps({"event": "migrated", "revision": revision}))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("create-admin", help="create an administrator account")
    create.add_argument("--email", required=True)
    create.add_argument("--full-name", required=True)
    user = sub.add_parser("create-user", help="create an admin or manager account")
    user.add_argument("--role", required=True, choices=["admin", "manager"])
    user.add_argument("--email", required=True)
    user.add_argument("--full-name", required=True)
    sub.add_parser("db-roles", help="create the migrator and app database roles (RDS master)")
    sub.add_parser("migrate", help="alembic upgrade head, then grants (migrator role)")
    args = parser.parse_args(argv)
    if args.command == "create-admin":
        return create_admin(args.email, args.full_name)
    if args.command == "create-user":
        return create_user(args.email, args.full_name, UserRole(args.role), "user_created")
    if args.command == "db-roles":
        return run_db_roles()
    if args.command == "migrate":
        return run_migrate()
    return 2  # pragma: no cover


if __name__ == "__main__":
    sys.exit(main())
