"""T-003b: `python -m app.cli deactivate-user`."""

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app import cli
from app.models.enums import UserRole
from tests.conftest import bearer, device_sign_in

ME = "/api/v1/auth/me"


def _active(db_engine: Any, user_id: Any) -> bool:
    with db_engine.connect() as connection:
        return bool(
            connection.execute(
                text("SELECT is_active FROM users WHERE id = :id"), {"id": user_id}
            ).scalar_one()
        )


def _sessions(db_engine: Any, user_id: Any) -> list[Any]:
    with db_engine.connect() as connection:
        return list(
            connection.execute(
                text("SELECT revoked_at, revoked_reason FROM auth_sessions WHERE user_id = :id"),
                {"id": user_id},
            )
        )


def test_deactivates_the_user_and_ends_every_session(
    client: TestClient, temp_user: Any, db_engine: Any, capsys: pytest.CaptureFixture[str]
) -> None:
    user = temp_user(role=UserRole.painter)
    first = device_sign_in(client, user.email, "Temp123!")
    device_sign_in(client, user.email, "Temp123!")
    assert cli.main(["deactivate-user", "--email", f"  {user.email.upper()} "]) == 0
    out, err = capsys.readouterr()
    line = json.loads(out.strip())
    assert line == {"event": "user_deactivated", "user_id": str(user.id), "sessions_revoked": 2}
    assert user.email not in out + err and "Temp123!" not in out + err
    assert not _active(db_engine, user.id)
    sessions = _sessions(db_engine, user.id)
    assert len(sessions) == 2
    assert all(
        row.revoked_at is not None and row.revoked_reason == "deactivated" for row in sessions
    )
    response = client.get(ME, headers=first.headers)
    assert response.status_code == 401 and response.json()["code"] == "account_inactive"


def test_is_idempotent_and_keeps_the_first_revocation_reason(
    client: TestClient, temp_user: Any, db_engine: Any, capsys: pytest.CaptureFixture[str]
) -> None:
    user = temp_user(role=UserRole.painter)
    login = device_sign_in(client, user.email, "Temp123!")
    client.delete("/api/v1/auth/sessions/current", headers=login.headers)
    assert cli.main(["deactivate-user", "--email", user.email]) == 0
    assert cli.main(["deactivate-user", "--email", user.email]) == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert [json.loads(line)["sessions_revoked"] for line in out] == [0, 0]
    assert _sessions(db_engine, user.id)[0].revoked_reason == "signed_out"
    assert not _active(db_engine, user.id)


def test_works_for_a_user_with_no_sessions_and_any_role(
    temp_user: Any, db_engine: Any, capsys: pytest.CaptureFixture[str]
) -> None:
    manager = temp_user(role=UserRole.manager)
    assert cli.main(["deactivate-user", "--email", manager.email]) == 0
    assert json.loads(capsys.readouterr().out)["sessions_revoked"] == 0
    assert not _active(db_engine, manager.id)


def test_other_users_are_untouched(
    client: TestClient, temp_user: Any, db_engine: Any, capsys: pytest.CaptureFixture[str]
) -> None:
    target, bystander = temp_user(role=UserRole.painter), temp_user(role=UserRole.painter)
    device_sign_in(client, target.email, "Temp123!")
    kept = device_sign_in(client, bystander.email, "Temp123!")
    cli.main(["deactivate-user", "--email", target.email])
    capsys.readouterr()
    assert _active(db_engine, bystander.id)
    assert _sessions(db_engine, bystander.id)[0].revoked_at is None
    assert client.get(ME, headers=bearer(kept.access_token)).status_code == 200


def test_unknown_email_is_an_error(capsys: pytest.CaptureFixture[str]) -> None:
    assert cli.main(["deactivate-user", "--email", "nobody@jobproof.test"]) == 1
    out, err = capsys.readouterr()
    assert out == "" and "No user" in err
    assert "nobody@jobproof.test" not in err


def test_email_is_required() -> None:
    with pytest.raises(SystemExit):
        cli.main(["deactivate-user"])
