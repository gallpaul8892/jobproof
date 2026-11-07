import httpx
import pytest

from tests.contract import assert_contract, contract_operations


def test_accepts_a_conforming_body() -> None:
    response = httpx.Response(200, json={"status": "ok", "database": "ok", "version": "0.1.0"})
    assert_contract(response, "getHealth")


def test_rejects_a_body_that_violates_the_schema() -> None:
    response = httpx.Response(200, json={"status": "fine", "database": "ok"})
    with pytest.raises(AssertionError, match="violates the contract"):
        assert_contract(response, "getHealth")


def test_rejects_an_undeclared_status() -> None:
    response = httpx.Response(418, json={})
    with pytest.raises(AssertionError, match="not declared"):
        assert_contract(response, "getHealth")


def test_resolves_shared_response_refs() -> None:
    problem = {
        "type": "https://jobproof.dev/problems/not_found",
        "title": "Not Found",
        "status": 404,
        "code": "not_found",
        "request_id": "abc-123",
    }
    response = httpx.Response(
        404, json=problem, headers={"content-type": "application/problem+json"}
    )
    assert_contract(response, "getManagerReport")
    bad = httpx.Response(
        404, json={**problem, "code": "nope"}, headers={"content-type": "application/problem+json"}
    )
    with pytest.raises(AssertionError, match="violates the contract"):
        assert_contract(bad, "getManagerReport")


def test_contract_has_operations() -> None:
    assert ("GET", "/health") in contract_operations()
