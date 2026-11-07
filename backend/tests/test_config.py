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


GOOD_JWT = "j" * 40
GOOD_PHOTO = "p" * 40


def _secrets(env: str, jwt_secret: str, photo_secret: str) -> Settings:
    return Settings(
        database_url=BASE["database_url"],
        app_env=env,  # type: ignore[arg-type]
        jwt_secret=jwt_secret,
        photo_url_secret=photo_secret,
        demo_accounts_enabled=False,
        fixed_now=None,
    )


@pytest.mark.parametrize("env", ["staging", "production"])
@pytest.mark.parametrize(
    ("jwt_secret", "photo_secret", "culprit"),
    [
        ("dev-only-jwt-secret-change-me-0123456789abcdef", GOOD_PHOTO, "JWT_SECRET"),
        ("dev-only-anything-else-0123456789abcdefghij", GOOD_PHOTO, "JWT_SECRET"),
        (GOOD_JWT, "dev-only-photo-secret-change-me-0123456789ab", "PHOTO_URL_SECRET"),
        (GOOD_JWT, "dev-only-something-0123456789abcdefghijklm", "PHOTO_URL_SECRET"),
        ("s" * 40, "s" * 40, "must differ"),
    ],
)
def test_real_environments_reject_dev_or_identical_secrets(
    env: str, jwt_secret: str, photo_secret: str, culprit: str
) -> None:
    with pytest.raises(ValidationError, match=culprit):
        _secrets(env, jwt_secret, photo_secret)


@pytest.mark.parametrize("env", ["staging", "production"])
def test_real_environments_accept_distinct_real_secrets(env: str) -> None:
    assert _secrets(env, GOOD_JWT, GOOD_PHOTO).app_env == env


@pytest.mark.parametrize("env", ["local", "test"])
def test_local_and_test_keep_dev_and_identical_secrets(env: str) -> None:
    dev = _secrets(
        env,
        "dev-only-jwt-secret-change-me-0123456789abcdef",
        "dev-only-photo-secret-change-me-0123456789ab",
    )
    assert dev.app_env == env
    assert _secrets(env, "s" * 40, "s" * 40).app_env == env


DEV_JWT = "dev-only-jwt-secret-change-me-0123456789abcdef"
DEV_PHOTO = "dev-only-photo-secret-change-me-0123456789ab"


@pytest.mark.parametrize("env", ["staging", "production"])
@pytest.mark.parametrize(
    ("jwt_secret", "photo_secret", "culprit"),
    [
        (" " + DEV_JWT, GOOD_PHOTO, "JWT_SECRET"),
        (DEV_JWT.upper(), GOOD_PHOTO, "JWT_SECRET"),
        (DEV_JWT + "  ", GOOD_PHOTO, "JWT_SECRET"),
        (GOOD_JWT, "\t" + DEV_PHOTO, "PHOTO_URL_SECRET"),
        (GOOD_JWT, DEV_PHOTO.upper(), "PHOTO_URL_SECRET"),
        (GOOD_JWT, DEV_PHOTO + "\n", "PHOTO_URL_SECRET"),
        (" " + GOOD_JWT, GOOD_PHOTO, "whitespace"),
        (GOOD_JWT + " ", GOOD_PHOTO, "whitespace"),
        (GOOD_JWT, GOOD_PHOTO + "\n", "whitespace"),
    ],
)
def test_secret_variants_cannot_evade_the_checks(
    env: str, jwt_secret: str, photo_secret: str, culprit: str
) -> None:
    with pytest.raises(ValidationError, match=culprit):
        _secrets(env, jwt_secret, photo_secret)


def test_secrets_differing_only_by_case_or_whitespace_count_as_equal() -> None:
    # Whitespace is refused outright; case-only differences hit the equality check.
    with pytest.raises(ValidationError, match="must differ"):
        _secrets("production", "S" * 40, "s" * 40)
    with pytest.raises(ValidationError, match="whitespace"):
        _secrets("production", "s" * 40, "s" * 40 + " ")


# ---- APP_ENV is required -----------------------------------------------------------------------


def _settings_from_env(monkeypatch: pytest.MonkeyPatch, app_env: str | None) -> Settings:
    monkeypatch.setenv("DATABASE_URL", BASE["database_url"])
    monkeypatch.setenv("JWT_SECRET", GOOD_JWT)
    monkeypatch.setenv("PHOTO_URL_SECRET", GOOD_PHOTO)
    monkeypatch.setenv("DEMO_ACCOUNTS_ENABLED", "false")
    monkeypatch.delenv("FIXED_NOW", raising=False)
    if app_env is None:
        monkeypatch.delenv("APP_ENV", raising=False)
    else:
        monkeypatch.setenv("APP_ENV", app_env)
    return Settings()  # type: ignore[call-arg]


@pytest.mark.parametrize("value", [None, ""])
def test_missing_app_env_fails_with_a_clear_message(
    monkeypatch: pytest.MonkeyPatch, value: str | None
) -> None:
    with pytest.raises(ValidationError) as error:
        _settings_from_env(monkeypatch, value)
    message = str(error.value)
    assert "APP_ENV is required" in message
    for allowed in ("local", "test", "staging", "production"):
        assert allowed in message


@pytest.mark.parametrize("value", ["local", "test", "staging", "production"])
def test_each_allowed_app_env_works(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    assert _settings_from_env(monkeypatch, value).app_env == value


@pytest.mark.parametrize("value", ["Production", " local", "prod", "LOCAL", "local ", "dev"])
def test_near_miss_app_env_values_fail(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    with pytest.raises(ValidationError, match="app_env"):
        _settings_from_env(monkeypatch, value)


def test_seed_and_alembic_entry_points_fail_clearly_without_app_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import subprocess
    import sys
    from pathlib import Path

    backend = Path(__file__).resolve().parents[1]
    env = {
        k: v
        for k, v in __import__("os").environ.items()
        if k not in ("APP_ENV", "FIXED_NOW", "SEED_ANCHOR_DATE")
    }
    for argv in (
        [sys.executable, "-m", "app.seed"],
        [sys.executable, "-m", "alembic", "upgrade", "head"],
    ):
        result = subprocess.run(  # noqa: S603
            argv, cwd=backend, env=env, capture_output=True, text=True, timeout=60, check=False
        )
        assert result.returncode != 0, argv
        assert "APP_ENV is required" in result.stderr, (argv, result.stderr[-500:])
