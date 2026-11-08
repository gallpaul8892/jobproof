"""T-002b: the create-admin command for real deployments."""

import json
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app import cli
from tests.conftest import login_token

EMAIL = "New.Admin@Example.test"
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
    return cli.main(["create-admin", *args])


def test_creates_an_admin_who_can_sign_in(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    capsys: pytest.CaptureFixture[str],
    db_engine: Any,
) -> None:
    code = _run(monkeypatch, "--email", f" {EMAIL} ", "--full-name", " Nina Admin ")
    assert code == 0
    out, err = capsys.readouterr()
    line = json.loads(out.strip())
    assert set(line) == {"event", "user_id"} and line["event"] == "admin_created"
    assert PASSWORD not in out + err and "example.test" not in out.lower()
    token = login_token(client, EMAIL, PASSWORD)
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).json()
    assert me["role"] == "admin" and me["full_name"] == "Nina Admin"
    assert me["email"] == EMAIL.lower()
    assert (
        client.get(
            "/api/v1/admin/settings", headers={"Authorization": f"Bearer {token}"}
        ).status_code
        == 200
    )
    with db_engine.connect() as connection:
        stored = connection.execute(
            text("SELECT password_hash, is_active FROM users WHERE id = :id"),
            {"id": line["user_id"]},
        ).one()
    assert stored.password_hash.startswith("$argon2id$") and stored.is_active


def test_a_duplicate_email_exits_1_and_creates_nothing(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], db_engine: Any
) -> None:
    assert _run(monkeypatch, "--email", EMAIL, "--full-name", "A") == 0
    capsys.readouterr()
    assert _run(monkeypatch, "--email", EMAIL.upper(), "--full-name", "B") == 1
    assert _run(monkeypatch, "--email", "admin@jobproof.test", "--full-name", "C") == 1
    _, err = capsys.readouterr()
    assert "already exists" in err and PASSWORD not in err
    with db_engine.connect() as connection:
        count = connection.execute(
            text("SELECT count(*) FROM users WHERE email LIKE '%@example.test'")
        ).scalar()
    assert count == 1


@pytest.mark.parametrize("password", ["short", "x" * 11, "x" * 201])
def test_weak_or_invalid_passwords_are_refused(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    db_engine: Any,
    password: str,
) -> None:
    assert _run(monkeypatch, "--email", EMAIL, "--full-name", "A", password=password) == 2
    out, err = capsys.readouterr()
    assert password not in out + err
    with db_engine.connect() as connection:
        assert (
            connection.execute(
                text("SELECT count(*) FROM users WHERE email LIKE '%@example.test'")
            ).scalar()
            == 0
        )


def test_the_password_is_prompted_twice_when_not_in_the_environment(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, capsys: pytest.CaptureFixture[str]
) -> None:
    answers = iter([PASSWORD, PASSWORD])
    monkeypatch.setattr(cli.getpass, "getpass", lambda prompt="": next(answers))
    assert _run(monkeypatch, "--email", EMAIL, "--full-name", "Prompted", password=None) == 0
    login_token(client, EMAIL, PASSWORD)
    assert PASSWORD not in "".join(capsys.readouterr())


def test_mismatched_prompts_exit_without_creating(
    monkeypatch: pytest.MonkeyPatch, db_engine: Any
) -> None:
    answers = iter([PASSWORD, PASSWORD + "x"])
    monkeypatch.setattr(cli.getpass, "getpass", lambda prompt="": next(answers))
    with pytest.raises(SystemExit):
        _run(monkeypatch, "--email", EMAIL, "--full-name", "A", password=None)
    with db_engine.connect() as connection:
        assert (
            connection.execute(
                text("SELECT count(*) FROM users WHERE email LIKE '%@example.test'")
            ).scalar()
            == 0
        )


@pytest.mark.parametrize(
    ("email", "name"),
    [
        ("not-an-email", "A"),
        (EMAIL, "  "),
        (EMAIL, "x" * 101),
        (EMAIL, "A\nB"),
        (EMAIL, "A\u0085B"),
        (EMAIL, "A\u007fB"),
        (EMAIL, "\ufeffAda"),
        (EMAIL, "Ada\u202e"),
        (EMAIL, "A\u200bda"),
        (EMAIL, "\u001fAda"),
    ],
)
def test_bad_email_or_name_is_refused(
    monkeypatch: pytest.MonkeyPatch, email: str, name: str
) -> None:
    assert _run(monkeypatch, "--email", email, "--full-name", name) == 2
