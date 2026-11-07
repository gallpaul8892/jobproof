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
    from app.seed.__main__ import main as seed

    seed()  # SEED_ANCHOR_DATE=2026-10-15, set above


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    from app.main import create_app

    with TestClient(create_app()) as test_client:
        yield test_client


# ---- API test helpers -------------------------------------------------------------------------
import datetime as dt  # noqa: E402
import uuid  # noqa: E402
from typing import Any  # noqa: E402

import jwt  # noqa: E402
from argon2 import PasswordHasher  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.models import User  # noqa: E402
from app.models.enums import UserRole  # noqa: E402
from app.seed.dataset import Dataset, build_dataset  # noqa: E402

ANCHOR = dt.date.fromisoformat(os.environ["SEED_ANCHOR_DATE"])
FIXED_NOW = dt.datetime.fromisoformat(os.environ["FIXED_NOW"])
MANAGER_LOGIN = ("manager@jobproof.test", "Manager123!")
MANAGER2_LOGIN = ("manager2@jobproof.test", "Manager123!")
PAINTER_LOGIN = ("painter@jobproof.test", "Painter123!")
ADMIN_LOGIN = ("admin@jobproof.test", "Admin123!")


@pytest.fixture(scope="session")
def ds() -> Dataset:
    """The expected data, built independently of the database."""
    return build_dataset(ANCHOR)


def login_token(client: TestClient, email: str, password: str) -> str:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return str(response.json()["access_token"])


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def manager_headers(client: TestClient) -> dict[str, str]:
    return bearer(login_token(client, *MANAGER_LOGIN))


@pytest.fixture(scope="session")
def manager2_headers(client: TestClient) -> dict[str, str]:
    return bearer(login_token(client, *MANAGER2_LOGIN))


@pytest.fixture(scope="session")
def admin_headers(client: TestClient) -> dict[str, str]:
    return bearer(login_token(client, *ADMIN_LOGIN))


@pytest.fixture(scope="session")
def painter_headers(client: TestClient) -> dict[str, str]:
    return bearer(login_token(client, *PAINTER_LOGIN))


def make_token(
    user_id: uuid.UUID | str,
    *,
    role: str = "manager",
    secret: str | None = None,
    issued_offset: int = 0,
    ttl: int = 1800,
    audience: str = "jobproof-api",
    issuer: str = "jobproof",
    drop: tuple[str, ...] = (),
) -> str:
    """A token as the API would issue it, with any claim bent out of shape for a test."""
    issued = int(FIXED_NOW.timestamp()) + issued_offset
    claims: dict[str, Any] = {
        "sub": str(user_id),
        "role": role,
        "iat": issued,
        "exp": issued + ttl,
        "iss": issuer,
        "aud": audience,
    }
    for name in drop:
        claims.pop(name)
    return jwt.encode(claims, secret or get_settings().jwt_secret, algorithm="HS256")


@pytest.fixture(scope="session")
def db_engine() -> Iterator[Any]:
    engine = create_engine(TEST_DATABASE_URL)
    yield engine
    engine.dispose()


@pytest.fixture
def temp_user(db_engine: Any) -> Iterator[Any]:
    """Factory for throwaway users (committed, so the API sees them), removed afterwards."""
    created: list[uuid.UUID] = []

    def create(
        *,
        role: UserRole = UserRole.manager,
        active: bool = True,
        password: str | None = "Temp123!",  # noqa: S107
    ) -> User:
        user_id = uuid.uuid4()
        user = User(
            id=user_id,
            email=f"temp-{user_id}@jobproof.test",
            full_name="Temp User",
            role=role,
            password_hash=PasswordHasher().hash(password) if password else None,
            is_active=active,
        )
        with Session(db_engine) as session:
            session.add(user)
            session.commit()
            session.refresh(user)
            session.expunge(user)
        created.append(user_id)
        return user

    yield create
    with Session(db_engine) as session:
        for user_id in created:
            session.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
        session.commit()


@pytest.fixture
def restore_settings(db_engine: Any) -> Iterator[None]:
    """Put the company settings record back to its default state after a test changed it."""
    from app.branding.defaults import DEFAULT_COMPANY_NAME, DEFAULT_THEME

    yield
    with db_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE company_settings SET company_name = :name, theme_primary = :p, "
                "theme_accent = :a, theme_background = :b, theme_surface = :s, theme_text = :t, "
                "updated_at = NULL, updated_by_id = NULL, updated_by_name = NULL"
            ),
            {
                "name": DEFAULT_COMPANY_NAME,
                "p": DEFAULT_THEME.primary,
                "a": DEFAULT_THEME.accent,
                "b": DEFAULT_THEME.background,
                "s": DEFAULT_THEME.surface,
                "t": DEFAULT_THEME.text,
            },
        )
