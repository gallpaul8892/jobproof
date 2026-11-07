import pytest
from pydantic import ValidationError

from app.config import Settings

BASE = {
    "database_url": "postgresql+psycopg://u:p@h:1/d",
    "jwt_secret": "j" * 32,
    "photo_url_secret": "p" * 32,
}


def test_defaults_and_comma_separated_origins() -> None:
    settings = Settings(**BASE, cors_allowed_origins="http://a.test, http://b.test")  # type: ignore[arg-type]
    assert settings.cors_allowed_origins == ["http://a.test", "http://b.test"]
    assert settings.jwt_ttl_seconds == 1800


def test_short_secrets_are_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(**{**BASE, "jwt_secret": "short"})


def test_wildcard_cors_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(**BASE, cors_allowed_origins="*")  # type: ignore[arg-type]


def test_production_refuses_demo_accounts_and_fixed_now() -> None:
    with pytest.raises(ValidationError):
        Settings(**BASE, app_env="production", demo_accounts_enabled=True)
    with pytest.raises(ValidationError):
        Settings(**BASE, app_env="production", fixed_now="2026-10-15T10:00:00Z")  # type: ignore[arg-type]
    assert (
        Settings(**BASE, app_env="production", demo_accounts_enabled=False, fixed_now=None).app_env
        == "production"
    )
