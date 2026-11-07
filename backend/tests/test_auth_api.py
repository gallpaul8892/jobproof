"""T-001c scenarios 1, 2 and 9: sign-in, uniform failures, demo accounts."""

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app
from app.models.enums import UserRole
from app.seed import DEMO_ACCOUNTS
from tests.conftest import MANAGER_LOGIN, PAINTER_LOGIN, bearer, login_token, make_token
from tests.contract import assert_contract

LOGIN = "/api/v1/auth/login"


def test_manager_signs_in_with_mixed_case_and_trailing_space(client: TestClient) -> None:
    response = client.post(
        LOGIN, json={"email": "Manager@JobProof.test ", "password": "Manager123!"}
    )
    assert response.status_code == 200
    assert_contract(response, "login")
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 1800
    assert body["access_token"]
    assert body["user"]["full_name"] == "Sarah Whitfield"
    assert body["user"]["role"] == "manager"
    assert body["user"]["email"] == "manager@jobproof.test"
    assert "password" not in response.text

    me = client.get("/api/v1/auth/me", headers=bearer(body["access_token"]))
    assert me.status_code == 200
    assert_contract(me, "getMe")
    assert me.json() == body["user"]


def test_painter_can_sign_in_and_see_themselves(client: TestClient) -> None:
    token = login_token(client, *PAINTER_LOGIN)
    me = client.get("/api/v1/auth/me", headers=bearer(token))
    assert me.status_code == 200
    assert me.json()["role"] == "painter"
    assert me.json()["full_name"] == "Dan Hughes"


def test_token_carries_the_documented_claims(client: TestClient) -> None:
    import jwt

    token = login_token(client, *MANAGER_LOGIN)
    claims = jwt.decode(token, options={"verify_signature": False})
    assert set(claims) == {"sub", "role", "iat", "exp", "iss", "aud"}
    assert claims["iss"] == "jobproof" and claims["aud"] == "jobproof-api"
    assert claims["role"] == "manager"
    assert claims["exp"] - claims["iat"] == 1800
    assert jwt.get_unverified_header(token)["alg"] == "HS256"


def test_login_accepts_surrounding_whitespace_only_in_the_email(client: TestClient) -> None:
    padded = client.post(LOGIN, json={"email": "manager@jobproof.test", "password": "Manager123! "})
    assert padded.status_code == 401


def _failures(client: TestClient, temp_user: object) -> dict[str, object]:
    inactive = temp_user(active=False)  # type: ignore[operator]
    attempts = {
        "wrong password": ("manager@jobproof.test", "not-the-password"),
        "unknown email": ("nobody@jobproof.test", "Manager123!"),
        "painter without password": ("priya.shah@jobproof.test", "anything"),
        "inactive user, right password": (inactive.email, "Temp123!"),
    }
    return {
        name: client.post(LOGIN, json={"email": e, "password": p})
        for name, (e, p) in attempts.items()
    }


def test_bad_credentials_are_rejected_uniformly(client: TestClient, temp_user: object) -> None:
    responses = _failures(client, temp_user)
    assert len(responses) == 4
    shapes = set()
    for name, response in responses.items():
        assert response.status_code == 401, name
        assert response.headers["content-type"].startswith("application/problem+json"), name
        assert_contract(response, "login")  # type: ignore[arg-type]
        body = response.json()  # type: ignore[attr-defined]
        assert body["code"] == "invalid_credentials"
        assert "access_token" not in body
        shapes.add((body["status"], body["code"], body["title"], body["detail"], body["type"]))
    assert len(shapes) == 1  # same status, code and detail for every failure


def test_every_failure_costs_one_password_verification(
    client: TestClient, temp_user: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Uniform timing: unknown users are checked against a dummy hash, never skipped."""
    import app.services.auth as auth_service

    calls: list[str | None] = []
    real = auth_service.verify_password

    def counting(stored: str | None, password: str) -> bool:
        calls.append(stored)
        return real(stored, password)

    monkeypatch.setattr(auth_service, "verify_password", counting)
    _failures(client, temp_user)
    assert len(calls) == 4
    assert calls.count(None) == 2  # unknown email and password-less painter: dummy hash used
    assert all(c is None or c.startswith("$argon2id$") for c in calls)


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"email": "manager@jobproof.test"}, "password"),
        ({"password": "Manager123!"}, "email"),
        ({"email": "manager@jobproof.test", "password": ""}, "password"),
        ({"email": "ab", "password": "x"}, "email"),
        ({"email": "manager@jobproof.test", "password": "x" * 201}, "password"),
        ({"email": "manager@jobproof.test", "password": "x", "role": "manager"}, "role"),
    ],
)
def test_invalid_login_bodies_are_422(client: TestClient, body: dict[str, str], field: str) -> None:
    response = client.post(LOGIN, json=body)
    assert response.status_code == 422
    assert_contract(response, "login")
    problem = response.json()
    assert problem["code"] == "validation_error"
    assert any(field in err["loc"] for err in problem["errors"])


def test_login_with_no_body_or_non_json_is_422(client: TestClient) -> None:
    assert client.post(LOGIN).status_code == 422
    assert (
        client.post(LOGIN, content="not json", headers={"Content-Type": "text/plain"}).status_code
        == 422
    )


def test_me_requires_a_valid_token(client: TestClient, ds: object) -> None:
    missing = client.get("/api/v1/auth/me")
    assert missing.status_code == 401
    assert missing.headers["www-authenticate"] == "Bearer"
    assert missing.json()["code"] == "unauthenticated"
    assert_contract(missing, "getMe")
    assert client.get("/api/v1/auth/me", headers=bearer("garbage")).status_code == 401


def test_role_and_active_flag_are_reloaded_from_the_database(
    client: TestClient, temp_user: object, db_engine: object
) -> None:
    from sqlalchemy import text

    user = temp_user(role=UserRole.manager)  # type: ignore[operator]
    token = login_token(client, user.email, "Temp123!")
    headers = bearer(token)
    assert client.get("/api/v1/manager/painters", headers=headers).status_code == 200

    def update(sql: str) -> None:
        with db_engine.begin() as connection:  # type: ignore[attr-defined]
            connection.execute(text(sql), {"id": user.id})

    update("UPDATE users SET role = 'painter' WHERE id = :id")  # token still says manager
    demoted = client.get("/api/v1/manager/painters", headers=headers)
    assert demoted.status_code == 403
    assert demoted.json()["code"] == "forbidden"
    assert client.get("/api/v1/auth/me", headers=headers).json()["role"] == "painter"

    update("UPDATE users SET role = 'manager', is_active = false WHERE id = :id")
    assert client.get("/api/v1/manager/painters", headers=headers).status_code == 401
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401

    update("DELETE FROM users WHERE id = :id")
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401


def test_token_with_unknown_subject_is_401(client: TestClient) -> None:
    import uuid

    token = make_token(uuid.uuid4())
    assert client.get("/api/v1/auth/me", headers=bearer(token)).status_code == 401


# ---- scenario 9: demo accounts ---------------------------------------------------------------


def test_demo_accounts_when_enabled(client: TestClient) -> None:
    response = client.get("/api/v1/auth/demo-accounts")
    assert response.status_code == 200
    assert_contract(response, "listDemoAccounts")
    assert [(a["role"], a["full_name"]) for a in response.json()] == [
        ("manager", "Sarah Whitfield"),
        ("manager", "Priya Nair"),
        ("painter", "Dan Hughes"),
        ("admin", "Tom Ashworth"),
    ]
    accounts = {a["role"]: a for a in reversed(response.json())}  # first manager wins
    assert set(accounts) == {"manager", "painter", "admin"}
    assert accounts["admin"]["email"] == "admin@jobproof.test"
    assert accounts["admin"]["password"] == "Admin123!"
    assert accounts["manager"]["email"] == "manager@jobproof.test"
    assert accounts["manager"]["password"] == "Manager123!"
    assert accounts["manager"]["full_name"] == "Sarah Whitfield"
    assert accounts["painter"]["email"] == "painter@jobproof.test"
    assert len(response.json()) == len(DEMO_ACCOUNTS)
    # The published credentials really work.
    for account in response.json():
        login_token(client, account["email"], account["password"])


def test_demo_accounts_are_404_when_disabled() -> None:
    settings = get_settings().model_copy(update={"demo_accounts_enabled": False})
    with TestClient(create_app(settings)) as disabled:
        response = disabled.get("/api/v1/auth/demo-accounts")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json()["code"] == "not_found"
    assert_contract(response, "listDemoAccounts")


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"email": "a\u0000@x.test", "password": "x"}, "email"),
        ({"email": "manager@jobproof.test", "password": "pa\u0000ss"}, "password"),
        ({"email": "\u0000\u0000\u0000", "password": "\u0000"}, "email"),
    ],
)
def test_nul_characters_in_login_are_422_not_500(
    client: TestClient, body: dict[str, str], field: str
) -> None:
    response = client.post(LOGIN, json=body)
    assert response.status_code == 422
    assert response.headers["content-type"].startswith("application/problem+json")
    assert_contract(response, "login")
    problem = response.json()
    assert problem["code"] == "validation_error" and problem["request_id"]
    assert any(field in err["loc"] for err in problem["errors"])
