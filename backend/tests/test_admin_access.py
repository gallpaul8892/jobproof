"""T-002b scenario 3: every admin operation, every kind of bad or wrong-role token."""

import uuid
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.models.enums import UserRole
from tests.conftest import bearer, make_token
from tests.contract import assert_contract, contract_operations

ADMIN_OPERATIONS = sorted(
    (method, path, operation_id)
    for (method, path), operation_id in contract_operations().items()
    if path.startswith("/api/v1/admin/")
)
# A body that is valid for the one PATCH operation, so 401/403 are not masked by 422.
PATCH_BODY = {"company_name": "Arbour Services"}


def _kwargs(method: str) -> dict[str, Any]:
    return {"json": PATCH_BODY} if method == "PATCH" else {}


@pytest.fixture
def bad_headers(admin_headers: dict[str, str], temp_user: Callable[..., Any]) -> dict[str, Any]:
    admin = temp_user(role=UserRole.admin)
    deactivated = temp_user(role=UserRole.admin, active=False)
    good = make_token(admin.id, role="admin")
    head, payload, signature = good.split(".")
    flipped = "A" if signature[0] != "A" else "B"
    return {
        "no token": {},
        "malformed token": bearer("not-a-jwt"),
        "wrong scheme": {"Authorization": f"Basic {good}"},
        "empty bearer": {"Authorization": "Bearer "},
        "expired token": bearer(make_token(admin.id, role="admin", issued_offset=-3600)),
        "tampered signature": bearer(f"{head}.{payload}.{flipped}{signature[1:]}"),
        "other secret": bearer(
            make_token(admin.id, role="admin", secret="another-secret-another-secret-0123456789")
        ),
        "unknown user": bearer(make_token(uuid.uuid4(), role="admin")),
        "deactivated admin": bearer(make_token(deactivated.id, role="admin")),
    }


def test_the_contract_has_admin_operations() -> None:
    methods = {(method, path) for method, path, _ in ADMIN_OPERATIONS}
    assert ("GET", "/api/v1/admin/settings") in methods
    assert ("PATCH", "/api/v1/admin/settings") in methods


@pytest.mark.parametrize(("method", "path", "operation_id"), ADMIN_OPERATIONS)
def test_unauthenticated_requests_get_401(
    client: TestClient,
    bad_headers: dict[str, Any],
    method: str,
    path: str,
    operation_id: str,
) -> None:
    for case, headers in bad_headers.items():
        response = client.request(method, path, headers=headers, **_kwargs(method))
        assert response.status_code == 401, f"{operation_id}: {case}"
        assert response.headers["www-authenticate"] == "Bearer", case
        assert response.json()["code"] == "unauthenticated", case
        assert_contract(response, operation_id)


@pytest.mark.parametrize(("method", "path", "operation_id"), ADMIN_OPERATIONS)
@pytest.mark.parametrize("persona", ["manager", "manager2", "painter"])
def test_other_personas_get_403(
    client: TestClient,
    request: pytest.FixtureRequest,
    persona: str,
    method: str,
    path: str,
    operation_id: str,
) -> None:
    headers = request.getfixturevalue(f"{persona}_headers")
    response = client.request(method, path, headers=headers, **_kwargs(method))
    assert response.status_code == 403
    assert response.headers["content-type"].startswith("application/problem+json")
    assert "www-authenticate" not in response.headers
    assert response.json()["code"] == "forbidden"
    assert_contract(response, operation_id)


def test_get_operations_return_200_for_the_admin(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    for method, path, operation_id in ADMIN_OPERATIONS:
        if method == "GET":
            response = client.get(path, headers=admin_headers)
            assert response.status_code == 200, operation_id
            assert_contract(response, operation_id)


def test_the_guard_runs_before_body_validation(
    client: TestClient, manager_headers: dict[str, str]
) -> None:
    assert client.patch("/api/v1/admin/settings", json={"bogus": 1}).status_code == 401
    forbidden = client.patch("/api/v1/admin/settings", json={"bogus": 1}, headers=manager_headers)
    assert forbidden.status_code == 403


def test_a_demoted_admin_loses_access_at_once(
    client: TestClient, temp_user: Callable[..., Any], db_engine: Any
) -> None:
    from sqlalchemy import text

    user = temp_user(role=UserRole.admin)
    headers = bearer(make_token(user.id, role="admin"))
    assert client.get("/api/v1/admin/settings", headers=headers).status_code == 200
    with db_engine.begin() as connection:
        connection.execute(
            text("UPDATE users SET role = 'manager' WHERE id = :id"), {"id": user.id}
        )
    assert client.get("/api/v1/admin/settings", headers=headers).status_code == 403


def test_only_declared_methods_are_allowed(
    client: TestClient, admin_headers: dict[str, str]
) -> None:
    for method in ("POST", "PUT", "DELETE"):
        response = client.request(method, "/api/v1/admin/settings", headers=admin_headers)
        assert response.status_code == 405
