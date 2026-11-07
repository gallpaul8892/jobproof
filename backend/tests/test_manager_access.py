"""T-001c scenario 3: every manager operation, every kind of bad or wrong-role token."""

from collections.abc import Callable
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient

from app.models.enums import UserRole
from tests.conftest import bearer, make_token
from tests.contract import assert_contract, contract_operations

MANAGER_OPERATIONS = sorted(
    (method, path, operation_id)
    for (method, path), operation_id in contract_operations().items()
    if path.startswith("/api/v1/manager/")
)
UNAUTHENTICATED_CASES = [
    "no token",
    "malformed token",
    "wrong scheme",
    "empty bearer",
    "expired token",
    "tampered signature",
    "other secret",
    "wrong audience",
    "wrong issuer",
    "missing exp claim",
    "unknown user",
    "deactivated user",
]


def test_the_contract_has_manager_operations() -> None:
    assert len(MANAGER_OPERATIONS) == 5
    assert all(method == "GET" for method, _, _ in MANAGER_OPERATIONS)


def _url(path: str, ds: Any) -> str:
    return path.replace("{report_id}", str(ds.reports[0].id))


@pytest.fixture
def bad_headers(ds: Any, temp_user: Callable[..., Any]) -> dict[str, dict[str, str]]:
    manager_id = next(u.id for u in ds.users if u.role.value == "manager")
    good = make_token(manager_id)
    head, payload, signature = good.split(".")
    flipped = "A" if signature[0] != "A" else "B"
    deactivated = temp_user(role=UserRole.manager, active=False)
    import uuid

    return {
        "no token": {},
        "malformed token": bearer("not-a-jwt"),
        "wrong scheme": {"Authorization": f"Basic {good}"},
        "empty bearer": {"Authorization": "Bearer "},
        "expired token": bearer(make_token(manager_id, issued_offset=-3600)),
        "tampered signature": bearer(f"{head}.{payload}.{flipped}{signature[1:]}"),
        "other secret": bearer(
            make_token(manager_id, secret="another-secret-another-secret-0123456789")
        ),
        "wrong audience": bearer(make_token(manager_id, audience="someone-else")),
        "wrong issuer": bearer(make_token(manager_id, issuer="not-jobproof")),
        "missing exp claim": bearer(make_token(manager_id, drop=("exp",))),
        "unknown user": bearer(make_token(uuid.uuid4())),
        "deactivated user": bearer(make_token(deactivated.id)),
    }


@pytest.mark.parametrize(("method", "path", "operation_id"), MANAGER_OPERATIONS)
def test_unauthenticated_requests_get_401(
    client: TestClient,
    ds: Any,
    bad_headers: dict[str, dict[str, str]],
    method: str,
    path: str,
    operation_id: str,
) -> None:
    assert set(bad_headers) == set(UNAUTHENTICATED_CASES)
    details = set()
    for case, headers in bad_headers.items():
        response = client.request(method, _url(path, ds), headers=headers)
        assert response.status_code == 401, f"{operation_id}: {case}"
        assert response.headers["www-authenticate"] == "Bearer", case
        assert response.headers["content-type"].startswith("application/problem+json"), case
        assert response.json()["code"] == "unauthenticated", case
        assert_contract(response, operation_id)
        details.add(response.json()["detail"])
    assert len(details) == 1  # the response never says why the token was refused


@pytest.mark.parametrize(("method", "path", "operation_id"), MANAGER_OPERATIONS)
def test_painter_token_gets_403(
    client: TestClient,
    ds: Any,
    painter_headers: dict[str, str],
    method: str,
    path: str,
    operation_id: str,
) -> None:
    response = client.request(method, _url(path, ds), headers=painter_headers)
    assert response.status_code == 403
    assert response.headers["content-type"].startswith("application/problem+json")
    assert "www-authenticate" not in response.headers
    assert response.json()["code"] == "forbidden"
    assert_contract(response, operation_id)


@pytest.mark.parametrize(("method", "path", "operation_id"), MANAGER_OPERATIONS)
def test_admin_token_gets_403(
    client: TestClient,
    ds: Any,
    admin_headers: dict[str, str],
    method: str,
    path: str,
    operation_id: str,
) -> None:
    response = client.request(method, _url(path, ds), headers=admin_headers)
    assert response.status_code == 403
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json()["code"] == "forbidden"
    assert_contract(response, operation_id)


@pytest.mark.parametrize(("method", "path", "operation_id"), MANAGER_OPERATIONS)
def test_second_manager_token_gets_200(
    client: TestClient,
    ds: Any,
    manager2_headers: dict[str, str],
    method: str,
    path: str,
    operation_id: str,
) -> None:
    assert client.request(method, _url(path, ds), headers=manager2_headers).status_code == 200


@pytest.mark.parametrize(("method", "path", "operation_id"), MANAGER_OPERATIONS)
def test_manager_token_gets_200(
    client: TestClient,
    ds: Any,
    manager_headers: dict[str, str],
    method: str,
    path: str,
    operation_id: str,
) -> None:
    response = client.request(method, _url(path, ds), headers=manager_headers)
    assert response.status_code == 200
    assert_contract(response, operation_id)


def test_authentication_is_checked_before_parameters(
    client: TestClient, painter_headers: dict[str, str]
) -> None:
    """Invalid input never leaks past the guard: 401 and 403 win over 422."""
    assert client.get("/api/v1/manager/reports?page=0").status_code == 401
    assert client.get("/api/v1/manager/reports/not-a-uuid").status_code == 401
    assert client.get("/api/v1/manager/reports?page=0", headers=painter_headers).status_code == 403
    assert (
        client.get("/api/v1/manager/reports/not-a-uuid", headers=painter_headers).status_code == 403
    )


def test_alg_none_and_hs512_tokens_are_refused(client: TestClient, ds: Any) -> None:
    manager_id = str(next(u.id for u in ds.users if u.role.value == "manager"))
    claims = jwt.decode(make_token(manager_id), options={"verify_signature": False})
    unsigned = jwt.encode(claims, key="", algorithm="none")
    other_alg = jwt.encode(claims, "x" * 64, algorithm="HS512")
    for token in (unsigned, other_alg):
        response = client.get("/api/v1/manager/dashboard", headers=bearer(token))
        assert response.status_code == 401


def test_only_get_is_allowed_on_manager_routes(
    client: TestClient, manager_headers: dict[str, str]
) -> None:
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        response = client.request(method, "/api/v1/manager/dashboard", headers=manager_headers)
        assert response.status_code == 405
        assert response.headers["content-type"].startswith("application/problem+json")
