"""Operational commands. Usage: python -m app.cli create-admin --email EMAIL --full-name NAME

The password comes from ADMIN_INITIAL_PASSWORD or, if unset, an interactive prompt (asked twice).
It is never echoed or logged. Works in every APP_ENV: it is not the seed.
"""

import argparse
import getpass
import json
import os
import sys

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

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


def create_admin(email: str, full_name: str) -> int:
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
                role=UserRole.admin,
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
            print(json.dumps({"event": "admin_created", "user_id": str(user.id)}))
    finally:
        engine.dispose()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("create-admin", help="create an administrator account")
    create.add_argument("--email", required=True)
    create.add_argument("--full-name", required=True)
    args = parser.parse_args(argv)
    if args.command == "create-admin":
        return create_admin(args.email, args.full_name)
    return 2  # pragma: no cover


if __name__ == "__main__":
    sys.exit(main())
