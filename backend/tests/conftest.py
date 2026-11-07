import os

# Environment must be in place before any app module reads settings.
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://jobproof:jobproof@127.0.0.1:5544/jobproof_test"
)
os.environ["APP_ENV"] = "test"
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-0123456789-abcdefghijklmnop")
os.environ.setdefault("PHOTO_URL_SECRET", "test-only-photo-secret-0123456789-abcdefghijkl")
os.environ["DEMO_ACCOUNTS_ENABLED"] = "true"
os.environ["FIXED_NOW"] = "2026-10-15T10:00:00Z"
os.environ["SEED_ANCHOR_DATE"] = "2026-10-15"

from collections.abc import Iterator  # noqa: E402
from pathlib import Path  # noqa: E402

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parents[1]


def alembic_config(url: str) -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.attributes["url"] = url
    return config


def ensure_database(url: str) -> None:
    """Create the database named in `url` if it does not exist."""
    parsed = make_url(url)
    admin = create_engine(parsed.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        exists = connection.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": parsed.database}
        ).scalar()
        if not exists:
            assert parsed.database is not None
            connection.execute(text(f'CREATE DATABASE "{parsed.database}"'))
    admin.dispose()


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> None:
    ensure_database(TEST_DATABASE_URL)
    command.upgrade(alembic_config(TEST_DATABASE_URL), "head")
    # Seeding joins in T-001b: `python -m app.seed` is a no-op today.


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    from app.main import create_app

    with TestClient(create_app()) as test_client:
        yield test_client
