"""Demo data for the AWS dev environment: `python -m app.seed.demo [--if-empty | --reset]`.

The normal seed (`python -m app.seed`) stays local/test only. This one runs only when every guard
holds (INFRA spec 4.5): APP_ENV=staging, DEMO_SEED_ALLOWED=true, and a DEMO_PASSWORD of at least
16 characters that is not one of the repository's published demo passwords. All demo users get
that one password.

--if-empty (default): inserts only when `users` is empty, otherwise exits 0 doing nothing. No
TRUNCATE is needed, so it also works as the app role.
--reset: truncates and reloads (dates move to today). It needs TRUNCATE, so it refuses unless it
runs as the migrator role (the app role has no TRUNCATE, B11).
"""

import argparse
import dataclasses
import logging
import sys
from datetime import date

from argon2 import PasswordHasher
from sqlalchemy import Engine, insert, text

from app.clock import today_london
from app.config import Settings, get_settings
from app.db import make_engine
from app.dbroles import MIGRATOR_ROLE, current_user
from app.logging import setup_logging
from app.models import Base
from app.seed import catalogue
from app.seed.dataset import Dataset, build_dataset
from app.seed.loader import SEED_PRESERVED_TABLES, load

logger = logging.getLogger("jobproof.seed.demo")

MIN_DEMO_PASSWORD = 16
MAX_DEMO_PASSWORD = 200
# Arbitrary constant: serialises concurrent --if-empty runs (two tasks starting together).
_LOCK_KEY = 4_227_001


class DemoSeedRefused(RuntimeError):
    """A guard failed. The message is safe to print (it never contains the password)."""


def repository_passwords() -> set[str]:
    """Every password published in the repository's demo catalogue."""
    passwords = {catalogue.MANAGER_PASSWORD, catalogue.ADMIN_PASSWORD}
    passwords.update(password for *_, password in catalogue.PAINTERS if password)
    passwords.update(account["password"] for account in catalogue.DEMO_ACCOUNTS)
    return {p for p in passwords if p}


def check_guards(settings: Settings) -> str:
    """Return the demo password if every guard holds, else raise DemoSeedRefused."""
    if settings.app_env != "staging":
        raise DemoSeedRefused(
            f"Refusing: APP_ENV={settings.app_env}. Demo data loads only when APP_ENV=staging "
            "(local and test use `python -m app.seed`; production never gets demo data)."
        )
    if not settings.demo_seed_allowed:
        raise DemoSeedRefused("Refusing: DEMO_SEED_ALLOWED is not true.")
    if settings.demo_password is None:
        raise DemoSeedRefused("Refusing: DEMO_PASSWORD is not set.")
    password = settings.demo_password.get_secret_value()
    if len(password) < MIN_DEMO_PASSWORD or len(password) > MAX_DEMO_PASSWORD:
        raise DemoSeedRefused(
            f"Refusing: DEMO_PASSWORD must be {MIN_DEMO_PASSWORD} to {MAX_DEMO_PASSWORD} "
            "characters."
        )
    if "\x00" in password:
        raise DemoSeedRefused("Refusing: DEMO_PASSWORD must not contain NUL characters.")
    published = {p.lower() for p in repository_passwords()}
    if password.lower() in published:
        raise DemoSeedRefused("Refusing: DEMO_PASSWORD is a password published in the repository.")
    return password


def demo_dataset(anchor: date, password: str) -> Dataset:
    """The standard dataset with every login's password replaced by `password`."""
    dataset = build_dataset(anchor)
    password_hash = PasswordHasher().hash(password)
    users = tuple(
        dataclasses.replace(user, password_hash=password_hash) if user.password_hash else user
        for user in dataset.users
    )
    return dataclasses.replace(dataset, users=users)


def load_if_empty(engine: Engine, dataset: Dataset) -> dict[str, int] | None:
    """Insert the dataset if `users` is empty; None means the database already had users."""
    counts: dict[str, int] = {}
    with engine.begin() as connection:
        connection.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": _LOCK_KEY})
        if connection.execute(text("SELECT 1 FROM users LIMIT 1")).first() is not None:
            return None
        for name, rows in dataset.tables():
            if name in SEED_PRESERVED_TABLES:
                continue
            counts[name] = len(rows)
            if rows:
                payload = [dataclasses.asdict(row) for row in rows]  # type: ignore[call-overload]
                connection.execute(insert(Base.metadata.tables[name]), payload)
    return counts


def run(settings: Settings, *, reset: bool) -> int:
    try:
        password = check_guards(settings)
    except DemoSeedRefused as exc:
        logger.error("demo seed refused: %s", exc)
        print(str(exc), file=sys.stderr)
        return 2
    anchor = settings.seed_anchor_date or today_london()
    dataset = demo_dataset(anchor, password)
    engine = make_engine(settings.database_url)
    try:
        if reset:
            with engine.connect() as connection:
                user = current_user(connection)
            if user != MIGRATOR_ROLE:
                message = f"Refusing --reset: it must run as {MIGRATOR_ROLE}, not {user}."
                logger.error("demo seed refused: %s", message)
                print(message, file=sys.stderr)
                return 2
            counts: dict[str, int] | None = load(engine, dataset)
        else:
            counts = load_if_empty(engine, dataset)
    finally:
        engine.dispose()
    if counts is None:
        logger.info("demo seed skipped: users table is not empty")
    else:
        logger.info(
            "demo seed loaded anchor=%s %s", anchor, " ".join(f"{k}={v}" for k, v in counts.items())
        )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.seed.demo")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--if-empty", action="store_true", help="load only if no users (default)")
    mode.add_argument("--reset", action="store_true", help="truncate and reload (migrator role)")
    args = parser.parse_args(argv)
    settings = get_settings()
    setup_logging(settings.log_level)
    return run(settings, reset=args.reset)


if __name__ == "__main__":
    sys.exit(main())
