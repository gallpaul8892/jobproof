"""P9 (INFRA-3): `app.cli create-user --role admin|manager`."""

import json
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app import cli
from tests.conftest import bearer, login_token

EMAIL = "New.User@Example.test"
PASSWORD = "a-long-enough-pass"  # noqa: S105


@pytest.fixture(autouse=True)
def _cleanup(db_engine: Any) -> Iterator[None]:
    yield
    with db_engine.begin() as connection:
        connection.execute(text("DELETE FROM users WHERE email LIKE '%@example.test'"))


def _run(monkeypatch: pytest.MonkeyPatch, *args: str, password: str | None = PASSWORD) -> int:
    if password is None:
        monkeypatch.delenv("ADMIN_INITIAL_PASSWORD", raising=False)
    else:
        monkeypatch.setenv("ADMIN_INITIAL_PASSWORD", password)
    return cli.main(["create-user", *args])


@pytest.mark.parametrize("role", ["admin", "manager"])
def test_creates_a_user_with_the_role_who_can_sign_in(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    capsys: pytest.CaptureFixture[str],
    db_engine: Any,
    role: str,
) -> None:
    code = _run(monkeypatch, "--role", role, "--email", f" {EMAIL} ", "--full-name", " Nina Lee ")
    assert code == 0
    out, err = capsys.readouterr()
    line = json.loads(out.strip())
    assert set(line) == {"event", "user_id"} and line["event"] == "user_created"
    assert PASSWORD not in out + err and "example.test" not in (out + err).lower()
    headers = bearer(login_token(client, EMAIL, PASSWORD))
    me = client.get("/api/v1/auth/me", headers=headers).json()
    assert me["role"] == role and me["full_name"] == "Nina Lee" and me["email"] == EMAIL.lower()
    allowed = "/api/v1/admin/settings" if role == "admin" else "/api/v1/manager/dashboard"
    denied = "/api/v1/manager/dashboard" if role == "admin" else "/api/v1/admin/settings"
    assert client.get(allowed, headers=headers).status_code == 200
    assert client.get(denied, headers=headers).status_code == 403
    with db_engine.connect() as connection:
        stored = connection.execute(
            text("SELECT password_hash, is_active FROM users WHERE id = :id"),
            {"id": line["user_id"]},
        ).one()
    assert stored.password_hash.startswith("$argon2id$") and stored.is_active


@pytest.mark.parametrize("role", ["painter", "superuser", "", "ADMIN"])
def test_only_admin_and_manager_can_be_created(
    monkeypatch: pytest.MonkeyPatch, db_engine: Any, role: str
) -> None:
    with pytest.raises(SystemExit) as excinfo:
        _run(monkeypatch, "--role", role, "--email", EMAIL, "--full-name", "A")
    assert excinfo.value.code == 2
    with db_engine.connect() as connection:
        count = connection.execute(
            text("SELECT count(*) FROM users WHERE email LIKE '%@example.test'")
        ).scalar()
    assert count == 0


def test_the_role_is_required() -> None:
    with pytest.raises(SystemExit) as excinfo:
        cli.main(["create-user", "--email", EMAIL, "--full-name", "A"])
    assert excinfo.value.code == 2


def test_a_duplicate_email_exits_1_whatever_the_role(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    assert _run(monkeypatch, "--role", "manager", "--email", EMAIL, "--full-name", "A") == 0
    capsys.readouterr()
    assert _run(monkeypatch, "--role", "admin", "--email", EMAIL.upper(), "--full-name", "B") == 1
    assert (
        _run(
            monkeypatch, "--role", "manager", "--email", "manager@jobproof.test", "--full-name", "C"
        )
        == 1
    )
    _, err = capsys.readouterr()
    assert "already exists" in err and PASSWORD not in err


@pytest.mark.parametrize("password", ["short", "x" * 11, "x" * 201])
def test_weak_passwords_are_refused(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], password: str
) -> None:
    code = _run(
        monkeypatch, "--role", "manager", "--email", EMAIL, "--full-name", "A", password=password
    )
    assert code == 2
    out, err = capsys.readouterr()
    assert password not in out + err


@pytest.mark.parametrize(
    ("email", "name"), [("not-an-email", "A"), (EMAIL, "  "), (EMAIL, "x" * 101), (EMAIL, "A\nB")]
)
def test_bad_email_or_name_is_refused(
    monkeypatch: pytest.MonkeyPatch, email: str, name: str
) -> None:
    assert _run(monkeypatch, "--role", "manager", "--email", email, "--full-name", name) == 2


def test_the_password_is_prompted_when_not_in_the_environment(
    monkeypatch: pytest.MonkeyPatch, client: TestClient
) -> None:
    answers = iter([PASSWORD, PASSWORD])
    monkeypatch.setattr(cli.getpass, "getpass", lambda prompt="": next(answers))
    assert (
        _run(monkeypatch, "--role", "manager", "--email", EMAIL, "--full-name", "P", password=None)
        == 0
    )
    login_token(client, EMAIL, PASSWORD)
