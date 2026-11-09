"""INFRA-3: DB_* connection settings as an alternative to DATABASE_URL."""

import base64
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app.config import Settings
from tests.conftest import TEST_DATABASE_URL

SECRETS = {"jwt_secret": "j" * 32, "photo_url_secret": "p" * 32}
# The environment of the test session sets DATABASE_URL and DEMO_ACCOUNTS_ENABLED; init values win.
NO_URL: dict[str, Any] = {"database_url": "", "demo_accounts_enabled": False, "fixed_now": None}
PARTS: dict[str, Any] = {
    "db_host": "db.internal",
    "db_port": 5433,
    "db_name": "jobproof",
    "db_user": "jobproof_app",
    "db_password": "p@ss:w/ord %'x",
}


def _settings(**overrides: Any) -> Settings:
    return Settings(**{"app_env": "local", **SECRETS, **NO_URL, **PARTS, **overrides})


def _fake_bundle(tmp_path: Path) -> Path:
    der = b"\x30\x82\x01\x00" + bytes(range(256))
    body = base64.encodebytes(der).decode()
    path = tmp_path / "bundle.pem"
    path.write_text(f"-----BEGIN CERTIFICATE-----\n{body}-----END CERTIFICATE-----\n")
    return path


def test_parts_build_a_url_with_an_escaped_password() -> None:
    url = make_url(_settings().database_url)
    assert url.drivername == "postgresql+psycopg"
    assert (url.host, url.port, url.database, url.username) == (
        "db.internal",
        5433,
        "jobproof",
        "jobproof_app",
    )
    assert url.password == PARTS["db_password"]
    assert url.query == {"sslmode": "prefer"}


def test_default_port_is_5432() -> None:
    parts = {k: v for k, v in PARTS.items() if k != "db_port"}
    settings = Settings(app_env="local", **SECRETS, **NO_URL, **parts)
    assert make_url(settings.database_url).port == 5432


def test_database_url_alone_is_unchanged() -> None:
    url = "postgresql+psycopg://u:p@h:1/d"
    settings = Settings(app_env="local", **SECRETS, database_url=url, demo_accounts_enabled=False)
    assert settings.database_url == url


def test_url_and_parts_together_are_refused() -> None:
    with pytest.raises(ValidationError, match="not both"):
        _settings(database_url="postgresql+psycopg://u:p@h:1/d")


@pytest.mark.parametrize("missing", ["db_host", "db_name", "db_user", "db_password"])
def test_incomplete_parts_name_the_missing_setting(missing: str) -> None:
    parts = {k: v for k, v in PARTS.items() if k != missing}
    with pytest.raises(ValidationError, match=missing.upper()):
        Settings(app_env="local", **SECRETS, **NO_URL, **parts)


def test_neither_url_nor_parts_is_refused() -> None:
    with pytest.raises(ValidationError, match="DATABASE_URL"):
        Settings(app_env="local", **SECRETS, **NO_URL)


def test_errors_never_echo_the_password() -> None:
    with pytest.raises(ValidationError) as excinfo:
        _settings(db_port=0)
    assert PARTS["db_password"] not in str(excinfo.value)
    with pytest.raises(ValidationError) as excinfo:
        _settings(app_env="staging", db_sslmode="require")
    assert PARTS["db_password"] not in str(excinfo.value)


def test_staging_defaults_to_verify_full_with_the_given_bundle(tmp_path: Path) -> None:
    bundle = _fake_bundle(tmp_path)
    url = make_url(_settings(app_env="staging", db_sslrootcert=str(bundle)).database_url)
    assert url.query == {"sslmode": "verify-full", "sslrootcert": str(bundle)}


@pytest.mark.parametrize("env", ["staging", "production"])
@pytest.mark.parametrize("mode", ["disable", "prefer", "require", "verify-ca"])
def test_aws_environments_refuse_weaker_tls(env: str, mode: str, tmp_path: Path) -> None:
    with pytest.raises(ValidationError, match="verify-full"):
        _settings(app_env=env, db_sslmode=mode, db_sslrootcert=str(_fake_bundle(tmp_path)))


def test_a_placeholder_bundle_stops_startup(tmp_path: Path) -> None:
    placeholder = tmp_path / "placeholder.pem"
    placeholder.write_text("# PLACEHOLDER - not a certificate\n")
    with pytest.raises(ValidationError, match="no valid PEM certificate"):
        _settings(app_env="production", db_sslrootcert=str(placeholder))


def test_a_missing_bundle_stops_startup(tmp_path: Path) -> None:
    with pytest.raises(ValidationError, match="cannot be read"):
        _settings(app_env="staging", db_sslrootcert=str(tmp_path / "nope.pem"))


def test_a_garbage_certificate_body_is_not_counted(tmp_path: Path) -> None:
    bad = tmp_path / "bad.pem"
    bad.write_text("-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n")
    with pytest.raises(ValidationError, match="no valid PEM certificate"):
        _settings(app_env="staging", db_sslrootcert=str(bad))


def test_parts_connect_to_the_local_database() -> None:
    target = make_url(TEST_DATABASE_URL)
    settings = _settings(
        db_host=target.host,
        db_port=target.port,
        db_name=target.database,
        db_user=target.username,
        db_password=target.password,
    )
    engine = create_engine(settings.database_url)
    with engine.connect() as connection:
        assert connection.execute(text("SELECT 1")).scalar() == 1
    engine.dispose()


def test_demo_seed_allowed_is_refused_in_production(tmp_path: Path) -> None:
    bundle = str(_fake_bundle(tmp_path))
    with pytest.raises(ValidationError, match="DEMO_SEED_ALLOWED"):
        _settings(app_env="production", demo_seed_allowed=True, db_sslrootcert=bundle)
    assert _settings(app_env="staging", demo_seed_allowed=True, db_sslrootcert=bundle)
