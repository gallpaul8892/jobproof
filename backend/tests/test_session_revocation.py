"""T-003b: the per-request session check, so deactivation and sign-out act immediately."""

import datetime as dt
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app import cli
from app.config import get_settings
from app.models.enums import UserRole
from app.security import create_access_token
from tests.conftest import (
    DEVICE_SESSIONS,
    FIXED_NOW,
    PAINTER_LOGIN,
    DeviceLogin,
    bearer,
    device_sign_in,
    login_token,
    make_token,
)

ME = "/api/v1/auth/me"
REFRESH = f"{DEVICE_SESSIONS}/refresh"


def _row(db_engine: Any, session_id: str) -> Any:
    with db_engine.connect() as connection:
        return connection.execute(
            text("SELECT * FROM auth_sessions WHERE id = :id"), {"id": session_id}
        ).one()


def _token(user_id: Any, sid: str, *, role: str = "painter", ttl: int = 900) -> str:
    return create_access_token(
        user_id=str(user_id),
        role=role,
        secret=get_settings().jwt_secret,
        ttl_seconds=ttl,
        now=FIXED_NOW,
        sid=sid,
    )


@pytest.fixture
def operative(temp_user: Any) -> Any:
    return temp_user(role=UserRole.painter)


def test_sign_out_takes_effect_before_the_access_token_expires(
    client: TestClient, operative_device_session: DeviceLogin
) -> None:
    login = operative_device_session
    assert client.get(ME, headers=login.headers).status_code == 200
    client.delete(f"{DEVICE_SESSIONS}/current", headers=login.headers)
    response = client.get(ME, headers=login.headers)
    assert response.status_code == 401
    assert response.json()["code"] == "session_ended"
    assert response.headers["www-authenticate"] == "Bearer"


def test_deactivation_is_immediate_and_leaves_no_way_back(
    client: TestClient, operative: Any, db_engine: Any, capsys: pytest.CaptureFixture[str]
) -> None:
    login = device_sign_in(client, operative.email, "Temp123!")
    other_device = device_sign_in(client, operative.email, "Temp123!")
    assert client.get(ME, headers=login.headers).status_code == 200

    assert cli.main(["deactivate-user", "--email", operative.email]) == 0
    capsys.readouterr()

    for headers in (login.headers, other_device.headers):
        response = client.get(ME, headers=headers)
        assert response.status_code == 401 and response.json()["code"] == "account_inactive"
    refresh = client.post(REFRESH, json={"refresh_token": login.refresh_token})
    assert refresh.status_code == 401 and refresh.json()["code"] == "account_inactive"
    assert _row(db_engine, login.session_id).revoked_reason == "deactivated"
    sign_in = client.post(
        DEVICE_SESSIONS,
        json={
            "email": operative.email,
            "password": "Temp123!",
            "device_id": str(uuid.uuid4()),
            "platform": "android",
            "app_version": "1.0.0",
        },
    )
    assert sign_in.status_code == 401 and sign_in.json()["code"] == "invalid_credentials"


def test_an_inactive_user_with_a_still_active_session_is_account_inactive(
    client: TestClient, operative: Any, db_engine: Any
) -> None:
    """Deactivated by other means than the CLI (the session row was not revoked)."""
    login = device_sign_in(client, operative.email, "Temp123!")
    with db_engine.begin() as connection:
        connection.execute(
            text("UPDATE users SET is_active = false WHERE id = :id"), {"id": operative.id}
        )
    response = client.get(ME, headers=login.headers)
    assert response.status_code == 401 and response.json()["code"] == "account_inactive"
    refresh = client.post(REFRESH, json={"refresh_token": login.refresh_token})
    assert refresh.json()["code"] == "account_inactive"
    assert _row(db_engine, login.session_id).revoked_reason == "deactivated"


def test_a_web_token_for_an_inactive_user_stays_unauthenticated(
    client: TestClient, operative: Any, db_engine: Any
) -> None:
    token = login_token(client, operative.email, "Temp123!")
    with db_engine.begin() as connection:
        connection.execute(
            text("UPDATE users SET is_active = false WHERE id = :id"), {"id": operative.id}
        )
    response = client.get(ME, headers=bearer(token))
    assert response.status_code == 401 and response.json()["code"] == "unauthenticated"


def test_the_absolute_expiry_ends_access_tokens_too(
    client: TestClient, operative_device_session: DeviceLogin, monkeypatch: pytest.MonkeyPatch
) -> None:
    login = operative_device_session
    monkeypatch.setattr(get_settings(), "fixed_now", FIXED_NOW + dt.timedelta(days=90))
    user_id = login.user["id"]
    long_lived = _token(user_id, login.session_id, ttl=100 * 86400)  # as if issued on day 0
    response = client.get(ME, headers=bearer(long_lived))
    assert response.status_code == 401 and response.json()["code"] == "session_ended"


def test_a_token_whose_session_does_not_exist_is_unauthenticated(
    client: TestClient, operative_device_session: DeviceLogin
) -> None:
    for sid in (str(uuid.uuid4()), "not-a-uuid"):
        token = _token(operative_device_session.user["id"], sid)
        response = client.get(ME, headers=bearer(token))
        assert response.status_code == 401 and response.json()["code"] == "unauthenticated", sid


def test_a_session_of_another_user_cannot_be_borrowed(
    client: TestClient, operative_device_session: DeviceLogin, operative: Any
) -> None:
    token = _token(operative.id, operative_device_session.session_id)
    response = client.get(ME, headers=bearer(token))
    assert response.status_code == 401 and response.json()["code"] == "unauthenticated"


def test_the_role_still_comes_from_the_database_not_the_token(
    client: TestClient, operative_device_session: DeviceLogin
) -> None:
    token = _token(
        operative_device_session.user["id"], operative_device_session.session_id, role="manager"
    )
    me = client.get(ME, headers=bearer(token))
    assert me.status_code == 200 and me.json()["role"] == "painter"
    assert client.get("/api/v1/manager/dashboard", headers=bearer(token)).status_code == 403


@pytest.mark.parametrize(
    "path", ["/api/v1/manager/dashboard", "/api/v1/admin/settings", "/api/v1/auth/me"]
)
def test_a_revoked_session_is_refused_on_every_authenticated_route(
    client: TestClient, operative_device_session: DeviceLogin, path: str
) -> None:
    login = operative_device_session
    assert client.get(path, headers=login.headers).status_code in (200, 403)
    client.delete(f"{DEVICE_SESSIONS}/current", headers=login.headers)
    response = client.get(path, headers=login.headers)
    # the session check runs before the role check
    assert response.status_code == 401 and response.json()["code"] == "session_ended"


def test_tokens_without_sid_ignore_device_sessions(client: TestClient, db_engine: Any) -> None:
    device = device_sign_in(client, *PAINTER_LOGIN)
    web = login_token(client, *PAINTER_LOGIN)
    client.delete(f"{DEVICE_SESSIONS}/current", headers=device.headers)
    assert client.get(ME, headers=bearer(web)).status_code == 200
    assert (
        client.get(ME, headers=bearer(make_token(device.user["id"], role="painter"))).status_code
        == 200
    )


def test_loading_the_seed_truncates_auth_sessions(client: TestClient, db_engine: Any) -> None:
    from app.seed.dataset import build_dataset
    from app.seed.loader import load
    from tests.conftest import ANCHOR

    device_sign_in(client, *PAINTER_LOGIN)
    with db_engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM auth_sessions")).scalar_one() >= 1
    load(db_engine, build_dataset(ANCHOR))
    with db_engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM auth_sessions")).scalar_one() == 0
