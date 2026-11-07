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


def _without_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.delenv("PHOTO_URL_SECRET", raising=False)


@pytest.mark.parametrize("env", ["local", "test"])
def test_dev_secret_defaults_exist_only_in_local_and_test(
    monkeypatch: pytest.MonkeyPatch, env: str
) -> None:
    _without_secrets(monkeypatch)
    settings = Settings(database_url=BASE["database_url"], app_env=env)  # type: ignore[arg-type]
    assert len(settings.jwt_secret) >= 32 and len(settings.photo_url_secret) >= 32
    assert settings.jwt_secret != settings.photo_url_secret


@pytest.mark.parametrize("env", ["staging", "production"])
@pytest.mark.parametrize("missing", ["jwt_secret", "photo_url_secret"])
def test_real_environments_refuse_to_start_without_explicit_secrets(
    monkeypatch: pytest.MonkeyPatch, env: str, missing: str
) -> None:
    _without_secrets(monkeypatch)
    values = {k: v for k, v in BASE.items() if k != missing}
    with pytest.raises(ValidationError, match=missing.upper()):
        Settings(**values, app_env=env)  # type: ignore[arg-type]


def test_secrets_come_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DEMO_ACCOUNTS_ENABLED", "false")
    monkeypatch.delenv("FIXED_NOW", raising=False)
    monkeypatch.setenv("DATABASE_URL", BASE["database_url"])
    monkeypatch.setenv("JWT_SECRET", "e" * 40)
    monkeypatch.setenv("PHOTO_URL_SECRET", "f" * 40)
    settings = Settings()  # type: ignore[call-arg]
    assert settings.jwt_secret == "e" * 40 and settings.photo_url_secret == "f" * 40
    monkeypatch.setenv("JWT_SECRET", "")  # an empty value counts as unset
    with pytest.raises(ValidationError, match="JWT_SECRET"):
        Settings()  # type: ignore[call-arg]
