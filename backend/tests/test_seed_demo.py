"""INFRA-3: `python -m app.seed.demo` and its guards (INFRA spec 4.5)."""

import logging
from typing import Any

import pytest
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from sqlalchemy import create_engine, text

from app.config import Settings
from app.seed import catalogue, demo
from app.seed.__main__ import main as normal_seed
from app.seed.dataset import build_dataset
from tests.conftest import ANCHOR, B11Database

DEMO_PASSWORD = "Demo-Only-pass-2026!"  # noqa: S105 - test value, 20 characters
GOOD: dict[str, Any] = {
    "app_env": "staging",
    "jwt_secret": "j" * 32,
    "photo_url_secret": "p" * 32,
    "demo_accounts_enabled": False,
    "fixed_now": None,
    "demo_seed_allowed": True,
    "demo_password": DEMO_PASSWORD,
    "seed_anchor_date": ANCHOR,
}


EDIT_ADMIN = "UPDATE users SET full_name = 'Edited by hand' WHERE role = 'admin'"
ADMIN_NAME = "SELECT full_name FROM users WHERE role = 'admin'"


def _settings(url: str, **overrides: Any) -> Settings:
    # Validated as local (the local test database has no TLS, which staging refuses), then
    # switched to the staging the demo guards require.
    wanted = overrides.pop("app_env", GOOD["app_env"])
    local = Settings(**{**GOOD, "app_env": "local", "database_url": url, **overrides})
    return local.model_copy(update={"app_env": wanted})


def _empty(b11: B11Database) -> None:
    """Remove all data (as the superuser, which may truncate), keeping the company settings."""
    engine = create_engine(b11.superuser)
    with engine.begin() as connection:
        connection.execute(text("SET LOCAL jobproof.allow_audit_truncate = 'on'"))
        connection.execute(text("TRUNCATE TABLE users CASCADE"))
        connection.execute(text("TRUNCATE TABLE customers CASCADE"))
    engine.dispose()


def _scalar(b11: B11Database, sql: str) -> Any:
    engine = create_engine(b11.superuser)
    with engine.connect() as connection:
        value = connection.execute(text(sql)).scalar()
    engine.dispose()
    return value


# ---- guards ---------------------------------------------------------------------------------


def test_the_repository_passwords_are_all_shorter_than_the_demo_minimum() -> None:
    assert demo.repository_passwords() >= {"Manager123!", "Admin123!", "Painter123!"}
    assert all(len(p) < demo.MIN_DEMO_PASSWORD for p in demo.repository_passwords())


@pytest.mark.parametrize("env", ["local", "test", "production"])
def test_only_staging_may_load_demo_data(env: str) -> None:
    settings = _settings("postgresql+psycopg://u:p@h:1/d").model_copy(update={"app_env": env})
    with pytest.raises(demo.DemoSeedRefused, match="APP_ENV=staging"):
        demo.check_guards(settings)


def test_demo_seed_allowed_must_be_true() -> None:
    settings = _settings("postgresql+psycopg://u:p@h:1/d", demo_seed_allowed=False)
    with pytest.raises(demo.DemoSeedRefused, match="DEMO_SEED_ALLOWED"):
        demo.check_guards(settings)


def test_a_demo_password_is_required() -> None:
    settings = _settings("postgresql+psycopg://u:p@h:1/d", demo_password=None)
    with pytest.raises(demo.DemoSeedRefused, match="DEMO_PASSWORD is not set"):
        demo.check_guards(settings)


@pytest.mark.parametrize("password", ["short", "x" * 15, "Manager123!"])
def test_a_short_demo_password_is_refused(password: str) -> None:
    settings = _settings("postgresql+psycopg://u:p@h:1/d", demo_password=password)
    with pytest.raises(demo.DemoSeedRefused, match="16 to 200") as excinfo:
        demo.check_guards(settings)
    assert password not in str(excinfo.value)


@pytest.mark.parametrize("variant", [str, str.upper, str.lower])
def test_a_published_repository_password_is_refused_whatever_its_length_or_case(
    monkeypatch: pytest.MonkeyPatch, variant: Any
) -> None:
    published = "Published-Demo-Pass-1"  # pretend the catalogue gained a long password
    monkeypatch.setattr(demo, "repository_passwords", lambda: {published})
    settings = _settings("postgresql+psycopg://u:p@h:1/d", demo_password=variant(published))
    with pytest.raises(demo.DemoSeedRefused, match="published in the repository") as excinfo:
        demo.check_guards(settings)
    assert published.lower() not in str(excinfo.value).lower()


def test_a_good_configuration_passes_the_guards() -> None:
    assert demo.check_guards(_settings("postgresql+psycopg://u:p@h:1/d")) == DEMO_PASSWORD


def test_refusals_exit_2_touch_nothing_and_never_print_the_password(
    b11_reseeded: B11Database, capsys: pytest.CaptureFixture[str]
) -> None:
    before = _scalar(b11_reseeded, "SELECT count(*) FROM users")
    for overrides in (
        {"app_env": "production", "demo_seed_allowed": False},
        {"demo_seed_allowed": False},
        {"demo_password": "tooshort"},
    ):
        settings = _settings(b11_reseeded.migrator_url, **overrides)
        assert demo.run(settings, reset=False) == 2
        assert demo.run(settings, reset=True) == 2
    captured = capsys.readouterr()
    assert DEMO_PASSWORD not in captured.out + captured.err
    assert _scalar(b11_reseeded, "SELECT count(*) FROM users") == before


# ---- --if-empty -----------------------------------------------------------------------------


def test_if_empty_loads_the_dataset_with_the_demo_password(
    b11_reseeded: B11Database, caplog: pytest.LogCaptureFixture
) -> None:
    _empty(b11_reseeded)
    caplog.set_level(logging.INFO)
    assert demo.run(_settings(b11_reseeded.migrator_url), reset=False) == 0
    expected = build_dataset(ANCHOR)
    assert _scalar(b11_reseeded, "SELECT count(*) FROM users") == len(expected.users)
    assert _scalar(b11_reseeded, "SELECT count(*) FROM jobs") == len(expected.jobs)
    engine = create_engine(b11_reseeded.superuser)
    with engine.connect() as connection:
        rows = connection.execute(
            text("SELECT email, role, password_hash FROM users ORDER BY email")
        ).all()
    engine.dispose()
    hashed = [row for row in rows if row.password_hash]
    assert {row.email for row in hashed} == {
        "manager@jobproof.test",
        "manager2@jobproof.test",
        "painter@jobproof.test",
        "admin@jobproof.test",
    }
    hasher = PasswordHasher()
    for row in hashed:
        assert hasher.verify(row.password_hash, DEMO_PASSWORD)
        for published in demo.repository_passwords():
            with pytest.raises(VerifyMismatchError):
                hasher.verify(row.password_hash, published)
    assert all(row.password_hash is None for row in rows if row not in hashed)
    assert DEMO_PASSWORD not in caplog.text


def test_if_empty_leaves_a_populated_database_alone(b11_reseeded: B11Database) -> None:
    engine = create_engine(b11_reseeded.superuser)
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE users SET full_name = 'Edited by hand' WHERE role = 'admin'")
        )
    engine.dispose()
    assert demo.run(_settings(b11_reseeded.migrator_url), reset=False) == 0
    assert _scalar(b11_reseeded, ADMIN_NAME) == "Edited by hand"


def test_if_empty_does_not_touch_the_company_settings(b11_reseeded: B11Database) -> None:
    _empty(b11_reseeded)
    engine = create_engine(b11_reseeded.superuser)
    with engine.begin() as connection:
        connection.execute(text("UPDATE company_settings SET company_name = 'Kept Ltd'"))
    engine.dispose()
    assert demo.run(_settings(b11_reseeded.migrator_url), reset=False) == 0
    assert _scalar(b11_reseeded, "SELECT company_name FROM company_settings") == "Kept Ltd"
    engine = create_engine(b11_reseeded.superuser)
    with engine.begin() as connection:
        connection.execute(text("UPDATE company_settings SET company_name = 'Arbour Services'"))
    engine.dispose()


def test_if_empty_works_as_the_app_role_which_has_no_truncate(
    b11_reseeded: B11Database,
) -> None:
    _empty(b11_reseeded)
    assert demo.run(_settings(b11_reseeded.app_url), reset=False) == 0
    assert _scalar(b11_reseeded, "SELECT count(*) FROM users") > 0


def test_if_empty_twice_is_a_no_op(b11_reseeded: B11Database) -> None:
    _empty(b11_reseeded)
    settings = _settings(b11_reseeded.app_url)
    assert demo.run(settings, reset=False) == 0
    first = _scalar(b11_reseeded, "SELECT count(*) FROM job_reports")
    assert demo.run(settings, reset=False) == 0
    assert _scalar(b11_reseeded, "SELECT count(*) FROM job_reports") == first


# ---- --reset --------------------------------------------------------------------------------


def test_reset_is_refused_for_every_role_but_the_migrator(
    b11_reseeded: B11Database, capsys: pytest.CaptureFixture[str]
) -> None:
    engine = create_engine(b11_reseeded.superuser)
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE users SET full_name = 'Edited by hand' WHERE role = 'admin'")
        )
    engine.dispose()
    for url in (b11_reseeded.app_url, b11_reseeded.superuser_url):
        assert demo.run(_settings(url), reset=True) == 2
    assert "must run as jobproof_migrator" in capsys.readouterr().err
    assert _scalar(b11_reseeded, ADMIN_NAME) == "Edited by hand"


def test_reset_as_the_migrator_truncates_and_reloads(b11_reseeded: B11Database) -> None:
    engine = create_engine(b11_reseeded.superuser)
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE users SET full_name = 'Edited by hand' WHERE role = 'admin'")
        )
    engine.dispose()
    assert demo.run(_settings(b11_reseeded.migrator_url), reset=True) == 0
    assert _scalar(b11_reseeded, ADMIN_NAME) == "Tom Ashworth"
    hasher = PasswordHasher()
    stored = _scalar(b11_reseeded, "SELECT password_hash FROM users WHERE role = 'admin'")
    assert hasher.verify(stored, DEMO_PASSWORD)


def test_the_app_role_really_cannot_do_what_reset_does(b11_reseeded: B11Database) -> None:
    """The reason --reset needs the migrator: the app role has no TRUNCATE (B11)."""
    engine = create_engine(b11_reseeded.app)
    with pytest.raises(Exception, match="permission denied"), engine.begin() as connection:
        load_sql = "TRUNCATE TABLE users CASCADE"
        connection.execute(text(load_sql))
    engine.dispose()


# ---- the command line ------------------------------------------------------------------------


def test_main_reads_the_environment(
    b11_reseeded: B11Database,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    settings = _settings(b11_reseeded.migrator_url)
    monkeypatch.setattr(demo, "get_settings", lambda: settings)
    assert demo.main([]) == 0  # default mode: --if-empty
    assert demo.main(["--if-empty"]) == 0
    assert demo.main(["--reset"]) == 0
    with pytest.raises(SystemExit):
        demo.main(["--if-empty", "--reset"])
    assert DEMO_PASSWORD not in "".join(capsys.readouterr())


def test_the_normal_seed_is_unchanged_and_still_refuses_staging(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.seed.__main__ as seed_main

    settings = _settings("postgresql+psycopg://u:p@h:1/d")
    monkeypatch.setattr(seed_main, "get_settings", lambda: settings)
    with pytest.raises(SystemExit, match="Refusing to seed: APP_ENV=staging"):
        normal_seed()


def test_the_published_demo_accounts_are_not_loaded_by_the_demo_seed() -> None:
    assert catalogue.MANAGER_PASSWORD == "Manager123!"
    dataset = demo.demo_dataset(ANCHOR, DEMO_PASSWORD)
    hasher = PasswordHasher()
    for user in dataset.users:
        if user.password_hash:
            with pytest.raises(VerifyMismatchError):
                hasher.verify(user.password_hash, catalogue.MANAGER_PASSWORD)
