"""T-003b: create, refresh (rotation, grace, reuse detection, expiry) and end device sessions."""

import datetime as dt
import logging
import threading
import uuid
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.enums import UserRole
from tests.conftest import (
    ADMIN_LOGIN,
    DEVICE_SESSIONS,
    FIXED_NOW,
    MANAGER_LOGIN,
    PAINTER_LOGIN,
    DeviceLogin,
    bearer,
    device_sign_in,
    login_token,
)
from tests.contract import assert_contract

REFRESH = f"{DEVICE_SESSIONS}/refresh"
CURRENT = f"{DEVICE_SESSIONS}/current"


def _payload(**changes: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "email": PAINTER_LOGIN[0],
        "password": PAINTER_LOGIN[1],
        "device_id": str(uuid.uuid4()),
        "device_name": "Android 14",
        "platform": "android",
        "app_version": "1.0.0",
    }
    body.update(changes)
    return {k: v for k, v in body.items() if v is not ...}


def _row(db_engine: Any, session_id: str) -> Any:
    with db_engine.connect() as connection:
        return connection.execute(
            text("SELECT * FROM auth_sessions WHERE id = :id"), {"id": session_id}
        ).one_or_none()


def _count(db_engine: Any) -> int:
    with db_engine.connect() as connection:
        return int(connection.execute(text("SELECT count(*) FROM auth_sessions")).scalar_one())


def _refresh(client: TestClient, token: str) -> Any:
    return client.post(REFRESH, json={"refresh_token": token})


def _later(monkeypatch: pytest.MonkeyPatch, **delta: float) -> None:
    monkeypatch.setattr(get_settings(), "fixed_now", FIXED_NOW + dt.timedelta(**delta))


@pytest.fixture(autouse=True)
def _clean_sessions(db_engine: Any) -> Any:
    yield
    with db_engine.begin() as connection:
        connection.execute(text("DELETE FROM auth_sessions"))


# ---- create ----------------------------------------------------------------------------------


def test_dan_signs_in_on_a_device(client: TestClient, db_engine: Any) -> None:
    response = client.post(DEVICE_SESSIONS, json=_payload())
    assert response.status_code == 201
    assert_contract(response, "createDeviceSession")
    body = response.json()
    assert body["token_type"] == "bearer" and body["expires_in"] == 900
    assert body["user"]["full_name"] == "Dan Hughes" and body["user"]["role"] == "painter"
    claims = jwt.decode(body["access_token"], options={"verify_signature": False})
    assert set(claims) == {"sub", "role", "iat", "exp", "iss", "aud", "sid"}
    assert claims["sid"] == body["session_id"] and claims["sub"] == body["user"]["id"]
    assert claims["exp"] - claims["iat"] == 900 and claims["role"] == "painter"
    session_id, _, secret = body["refresh_token"].partition(".")
    assert session_id == body["session_id"] and len(secret) == 43
    # 30 days idle, 90 days absolute; the response names the (earlier) idle expiry
    assert body["refresh_expires_at"] == "2026-11-14T10:00:00Z"
    row = _row(db_engine, body["session_id"])
    assert row.generation == 1 and row.revoked_at is None and row.previous_refresh_hash is None
    assert row.absolute_expires_at == FIXED_NOW + dt.timedelta(days=90)
    assert row.platform == "android" and row.app_version == "1.0.0"
    # only a hash of the secret is stored
    assert secret not in "".join(str(value) for value in row)
    assert len(row.refresh_hash) == 64


def test_the_access_token_works_on_ordinary_endpoints(
    operative_device_session: DeviceLogin, client: TestClient
) -> None:
    me = client.get("/api/v1/auth/me", headers=operative_device_session.headers)
    assert me.status_code == 200 and me.json()["full_name"] == "Dan Hughes"


def test_device_name_is_optional_and_trimmed(client: TestClient, db_engine: Any) -> None:
    without = client.post(DEVICE_SESSIONS, json=_payload(device_name=...))
    assert without.status_code == 201
    padded = client.post(DEVICE_SESSIONS, json=_payload(device_name="  Pixel 8  "))
    assert _row(db_engine, padded.json()["session_id"]).device_name == "Pixel 8"
    assert _row(db_engine, without.json()["session_id"]).device_name is None


@pytest.mark.parametrize(
    "changes",
    [
        {"email": "nobody@jobproof.test"},
        {"password": "wrong"},
        {"email": "priya.shah@jobproof.test"},  # a painter with no password set
    ],
)
def test_bad_credentials_are_401_and_keep_no_session(
    client: TestClient, db_engine: Any, changes: dict[str, str]
) -> None:
    response = client.post(DEVICE_SESSIONS, json=_payload(**changes))
    assert response.status_code == 401
    assert_contract(response, "createDeviceSession")
    assert response.json()["code"] == "invalid_credentials"
    assert _count(db_engine) == 0


def test_an_inactive_account_gets_the_same_401(
    client: TestClient, temp_user: Any, db_engine: Any
) -> None:
    from app.models.enums import UserRole

    user = temp_user(role=UserRole.painter, active=False)
    response = client.post(DEVICE_SESSIONS, json=_payload(email=user.email, password="Temp123!"))
    assert response.status_code == 401 and response.json()["code"] == "invalid_credentials"
    assert _count(db_engine) == 0


@pytest.mark.parametrize("login", [MANAGER_LOGIN, ADMIN_LOGIN])
def test_managers_and_admins_are_refused_without_a_session(
    client: TestClient, db_engine: Any, login: tuple[str, str]
) -> None:
    response = client.post(DEVICE_SESSIONS, json=_payload(email=login[0], password=login[1]))
    assert response.status_code == 403
    assert_contract(response, "createDeviceSession")
    assert response.json()["code"] == "operatives_only"
    assert "access_token" not in response.text
    assert _count(db_engine) == 0


def test_the_role_is_only_revealed_after_the_password_is_right(client: TestClient) -> None:
    response = client.post(
        DEVICE_SESSIONS, json=_payload(email=MANAGER_LOGIN[0], password="not-the-password")
    )
    assert response.status_code == 401 and response.json()["code"] == "invalid_credentials"


@pytest.mark.parametrize(
    "changes",
    [
        {"device_id": ...},
        {"device_id": "not-a-uuid"},
        {"platform": "windows"},
        {"platform": ...},
        {"app_version": "1.0"},
        {"app_version": ...},
        {"app_version": "1.0.0-beta"},
        {"email": ""},
        {"password": ""},
        {"device_name": "x" * 61},
        {"device_name": "bad‮text"},
        {"role": "manager"},  # unknown field
    ],
)
def test_validation_errors_are_422(
    client: TestClient, db_engine: Any, changes: dict[str, Any]
) -> None:
    response = client.post(DEVICE_SESSIONS, json=_payload(**changes))
    assert response.status_code == 422
    assert_contract(response, "createDeviceSession")
    assert response.json()["code"] == "validation_error"
    assert _count(db_engine) == 0


def test_a_new_sign_in_on_the_same_device_replaces_the_old_session(
    client: TestClient, db_engine: Any
) -> None:
    first = device_sign_in(client, *PAINTER_LOGIN)
    second = device_sign_in(client, *PAINTER_LOGIN, device_id=first.device_id)
    old = _row(db_engine, first.session_id)
    assert old.revoked_reason == "replaced" and old.revoked_at == FIXED_NOW
    assert _row(db_engine, second.session_id).revoked_at is None
    assert _refresh(client, first.refresh_token).json()["code"] == "session_ended"
    assert client.get("/api/v1/auth/me", headers=first.headers).json()["code"] == "session_ended"
    assert client.get("/api/v1/auth/me", headers=second.headers).status_code == 200


def test_two_devices_can_be_signed_in_at_once(client: TestClient) -> None:
    one = device_sign_in(client, *PAINTER_LOGIN)
    two = device_sign_in(client, *PAINTER_LOGIN)
    assert one.session_id != two.session_id
    for login in (one, two):
        assert client.get("/api/v1/auth/me", headers=login.headers).status_code == 200


def test_the_web_login_is_unchanged_and_has_no_session(client: TestClient, db_engine: Any) -> None:
    token = login_token(client, *PAINTER_LOGIN)
    assert "sid" not in jwt.decode(token, options={"verify_signature": False})
    assert _count(db_engine) == 0


# ---- refresh ---------------------------------------------------------------------------------


def test_refresh_rotates_the_pair(client: TestClient, db_engine: Any) -> None:
    login = device_sign_in(client, *PAINTER_LOGIN)
    response = _refresh(client, login.refresh_token)
    assert response.status_code == 200
    assert_contract(response, "refreshDeviceSession")
    body = response.json()
    assert body["session_id"] == login.session_id and body["user"] == login.user
    assert body["refresh_token"] != login.refresh_token
    assert body["refresh_token"].startswith(f"{login.session_id}.")
    row = _row(db_engine, login.session_id)
    assert row.generation == 2 and row.rotated_at == FIXED_NOW and row.previous_refresh_hash
    # the new access token carries the same sid
    claims = jwt.decode(body["access_token"], options={"verify_signature": False})
    assert claims["sid"] == login.session_id
    assert client.get("/api/v1/auth/me", headers=bearer(body["access_token"])).status_code == 200


def test_a_lost_response_can_be_retried_within_the_grace_period(
    client: TestClient, db_engine: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    login = device_sign_in(client, *PAINTER_LOGIN)
    lost = _refresh(client, login.refresh_token).json()  # the app never received this one
    _later(monkeypatch, seconds=60)
    retry = _refresh(client, login.refresh_token)  # exactly 60 s: still inside the window
    assert retry.status_code == 200
    assert_contract(retry, "refreshDeviceSession")
    assert retry.json()["refresh_token"] not in (lost["refresh_token"], login.refresh_token)
    assert _row(db_engine, login.session_id).generation == 3
    # the pair the app did receive works; the one it never received is dead and trips detection
    assert _refresh(client, retry.json()["refresh_token"]).status_code == 200


def test_the_unreceived_token_dies_but_its_use_changes_nothing(
    client: TestClient, db_engine: Any
) -> None:
    login = device_sign_in(client, *PAINTER_LOGIN)
    lost = _refresh(client, login.refresh_token).json()
    retry = _refresh(client, login.refresh_token)  # grace retry
    assert retry.status_code == 200
    before = _row(db_engine, login.session_id)
    dead = _refresh(client, lost["refresh_token"])
    assert dead.status_code == 401 and dead.json()["code"] == "session_ended"
    after = _row(db_engine, login.session_id)
    assert after.revoked_at is None and after.generation == before.generation
    assert _refresh(client, retry.json()["refresh_token"]).status_code == 200


def test_an_old_token_after_the_grace_period_revokes_the_session(
    client: TestClient, db_engine: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    login = device_sign_in(client, *PAINTER_LOGIN)
    newest = _refresh(client, login.refresh_token).json()
    _later(monkeypatch, seconds=61)
    stolen = _refresh(client, login.refresh_token)
    assert stolen.status_code == 401
    assert_contract(stolen, "refreshDeviceSession")
    assert stolen.json()["code"] == "session_ended"
    row = _row(db_engine, login.session_id)
    assert row.revoked_reason == "reuse_detected" and row.revoked_at is not None
    # the whole session is gone, including the legitimate newest token and its access token
    assert _refresh(client, newest["refresh_token"]).json()["code"] == "session_ended"
    me = client.get("/api/v1/auth/me", headers=bearer(newest["access_token"]))
    assert me.status_code == 401 and me.json()["code"] == "session_ended"


def test_a_token_two_generations_old_is_refused_without_changing_the_session(
    client: TestClient, db_engine: Any
) -> None:
    login = device_sign_in(client, *PAINTER_LOGIN)
    second = _refresh(client, login.refresh_token).json()
    third = _refresh(client, second["refresh_token"]).json()
    before = _row(db_engine, login.session_id)
    response = _refresh(client, login.refresh_token)  # neither current nor previous
    assert response.status_code == 401 and response.json()["code"] == "session_ended"
    after = _row(db_engine, login.session_id)
    assert after.revoked_at is None and after.generation == before.generation
    assert _refresh(client, third["refresh_token"]).status_code == 200


def test_a_right_session_id_with_an_unknown_secret_changes_nothing(
    client: TestClient, db_engine: Any
) -> None:
    login = device_sign_in(client, *PAINTER_LOGIN)
    before = _row(db_engine, login.session_id)
    forged = f"{login.session_id}.{'A' * 43}"
    response = _refresh(client, forged)
    assert response.status_code == 401 and response.json()["code"] == "session_ended"
    assert_contract(response, "refreshDeviceSession")
    after = _row(db_engine, login.session_id)
    assert after.revoked_at is None and after.revoked_reason is None
    assert after.refresh_hash == before.refresh_hash and after.generation == before.generation
    # the real phone is not logged out by somebody guessing
    assert _refresh(client, login.refresh_token).status_code == 200


def test_an_unknown_secret_for_a_deactivated_account_does_not_reveal_it(
    client: TestClient, db_engine: Any, temp_user: Any
) -> None:
    user = temp_user(role=UserRole.painter)
    login = device_sign_in(client, user.email, "Temp123!")
    with Session(db_engine) as s:
        s.execute(text("UPDATE users SET is_active = false WHERE id = :i"), {"i": user.id})
        s.commit()
    response = _refresh(client, f"{login.session_id}.{'A' * 43}")
    assert response.json()["code"] == "session_ended"  # not account_inactive
    assert _refresh(client, login.refresh_token).json()["code"] == "account_inactive"


@pytest.mark.parametrize(
    "token",
    [
        "x" * 30,
        f"{uuid.uuid4()}.{'B' * 43}",  # no such session
        f"not-a-uuid.{'B' * 43}",
        f"{uuid.uuid4()}.",
        f".{'B' * 43}",
    ],
)
def test_unknown_or_malformed_tokens_are_401_session_ended(client: TestClient, token: str) -> None:
    response = _refresh(client, token)
    assert response.status_code == 401
    assert_contract(response, "refreshDeviceSession")
    assert response.json()["code"] == "session_ended"
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"refresh_token": "short"},
        {"refresh_token": "x" * 201},
        {"refresh_token": "x" * 30, "extra": 1},
    ],
)
def test_refresh_validation_is_422(client: TestClient, body: dict[str, Any]) -> None:
    response = client.post(REFRESH, json=body)
    assert response.status_code == 422
    assert_contract(response, "refreshDeviceSession")


def test_a_refresh_token_cannot_be_used_as_an_access_token(
    client: TestClient, operative_device_session: DeviceLogin
) -> None:
    response = client.get("/api/v1/auth/me", headers=bearer(operative_device_session.refresh_token))
    assert response.status_code == 401 and response.json()["code"] == "unauthenticated"


def test_using_the_session_extends_the_idle_expiry(
    client: TestClient, db_engine: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    login = device_sign_in(client, *PAINTER_LOGIN)
    _later(monkeypatch, days=20)
    body = _refresh(client, login.refresh_token).json()
    assert body["refresh_expires_at"] == "2026-12-04T10:00:00Z"  # 20 + 30 days from 15 October
    _later(monkeypatch, days=49, seconds=-1)  # 29 days after the refresh
    body = _refresh(client, body["refresh_token"])
    assert body.status_code == 200


def test_thirty_days_without_use_ends_the_session(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    login = device_sign_in(client, *PAINTER_LOGIN)
    _later(monkeypatch, days=30)
    response = _refresh(client, login.refresh_token)
    assert response.status_code == 401 and response.json()["code"] == "session_ended"
    assert_contract(response, "refreshDeviceSession")


def test_ninety_days_after_sign_in_is_the_limit_however_often_it_is_used(
    client: TestClient, db_engine: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    login = device_sign_in(client, *PAINTER_LOGIN)
    token = login.refresh_token
    for days in (29, 58, 87):
        _later(monkeypatch, days=days)
        response = _refresh(client, token)
        assert response.status_code == 200, days
        token = response.json()["refresh_token"]
    # 87 + 30 days would be day 117; it is capped at day 90
    assert response.json()["refresh_expires_at"] == "2027-01-13T10:00:00Z"
    _later(monkeypatch, days=90)
    ended = _refresh(client, token)
    assert ended.status_code == 401 and ended.json()["code"] == "session_ended"


def test_access_tokens_expire_after_fifteen_minutes(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    login = device_sign_in(client, *PAINTER_LOGIN)
    _later(monkeypatch, minutes=14)
    assert client.get("/api/v1/auth/me", headers=login.headers).status_code == 200
    _later(monkeypatch, minutes=16)
    response = client.get("/api/v1/auth/me", headers=login.headers)
    assert response.status_code == 401 and response.json()["code"] == "unauthenticated"
    assert _refresh(client, login.refresh_token).status_code == 200  # refresh still works


def test_two_refreshes_at_once_do_not_fail(client: TestClient, db_engine: Any) -> None:
    login = device_sign_in(client, *PAINTER_LOGIN)
    results: list[int] = []

    def go() -> None:
        results.append(_refresh(client, login.refresh_token).status_code)

    threads = [threading.Thread(target=go) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    # The row lock serialises them: the second one is the lost-response retry (grace period).
    assert results == [200, 200]
    assert _row(db_engine, login.session_id).generation == 3


# ---- sign out --------------------------------------------------------------------------------


def test_sign_out_revokes_the_session_at_once(client: TestClient, db_engine: Any) -> None:
    login = device_sign_in(client, *PAINTER_LOGIN)
    response = client.delete(CURRENT, headers=login.headers)
    assert response.status_code == 204 and response.content == b""
    assert_contract(response, "endDeviceSession")
    assert _row(db_engine, login.session_id).revoked_reason == "signed_out"
    refreshed = _refresh(client, login.refresh_token)
    assert refreshed.status_code == 401 and refreshed.json()["code"] == "session_ended"


def test_sign_out_is_idempotent(client: TestClient, db_engine: Any) -> None:
    login = device_sign_in(client, *PAINTER_LOGIN)
    assert client.delete(CURRENT, headers=login.headers).status_code == 204
    first = _row(db_engine, login.session_id).revoked_at
    again = client.delete(CURRENT, headers=login.headers)
    assert again.status_code == 204
    assert _row(db_engine, login.session_id).revoked_at == first


def test_sign_out_only_ends_this_device(client: TestClient) -> None:
    one = device_sign_in(client, *PAINTER_LOGIN)
    two = device_sign_in(client, *PAINTER_LOGIN)
    client.delete(CURRENT, headers=one.headers)
    assert client.get("/api/v1/auth/me", headers=two.headers).status_code == 200
    assert _refresh(client, two.refresh_token).status_code == 200


@pytest.mark.parametrize("login", [MANAGER_LOGIN, PAINTER_LOGIN, ADMIN_LOGIN])
def test_sign_out_with_a_web_token_is_204_and_changes_nothing(
    client: TestClient, db_engine: Any, login: tuple[str, str]
) -> None:
    device = device_sign_in(client, *PAINTER_LOGIN)
    token = login_token(client, *login)
    response = client.delete(CURRENT, headers=bearer(token))
    assert response.status_code == 204
    assert _row(db_engine, device.session_id).revoked_at is None
    assert (
        client.get("/api/v1/auth/me", headers=bearer(token)).status_code == 200
    )  # web token lives


def test_sign_out_needs_a_token(client: TestClient) -> None:
    response = client.delete(CURRENT)
    assert response.status_code == 401
    assert_contract(response, "endDeviceSession")
    assert response.json()["code"] == "unauthenticated"


# ---- logging ---------------------------------------------------------------------------------


def test_no_token_password_or_email_is_logged(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    login = device_sign_in(client, *PAINTER_LOGIN)
    refreshed = _refresh(client, login.refresh_token).json()
    _refresh(client, login.refresh_token)  # inside grace
    client.post(DEVICE_SESSIONS, json=_payload(password="wrong-password-xyz"))
    client.post(DEVICE_SESSIONS, json=_payload(email=MANAGER_LOGIN[0], password=MANAGER_LOGIN[1]))
    client.delete(CURRENT, headers=bearer(refreshed["access_token"]))
    logged = "\n".join(
        f"{record.getMessage()} {sorted(vars(record).items(), key=str)}"
        for record in caplog.records
    )
    secrets_ = [
        login.refresh_token.partition(".")[2],
        refreshed["refresh_token"].partition(".")[2],
        login.access_token,
        refreshed["access_token"],
        PAINTER_LOGIN[1],
        "wrong-password-xyz",
        PAINTER_LOGIN[0],
        MANAGER_LOGIN[0],
    ]
    for secret in secrets_:
        assert secret not in logged
    assert login.session_id in logged  # the session id is what is logged
