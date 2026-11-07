import httpx
import pytest

from tests.contract import PENDING_TICKETS, assert_contract, contract_operations, strip_pending


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


def test_strip_pending_removes_operations_parameters_and_required_properties() -> None:
    spec = {
        "paths": {
            "/a": {
                "get": {
                    "operationId": "built",
                    "parameters": [
                        {"name": "keep", "in": "query"},
                        {"name": "sort", "in": "query", "x-ticket": "T-X"},
                    ],
                },
                "post": {"operationId": "pending", "x-ticket": "T-X"},
            },
            "/b": {"get": {"operationId": "onlyPending", "x-ticket": "T-X"}},
            "/c": {"get": {"operationId": "otherTicket", "x-ticket": "T-Y"}},
        },
        "components": {
            "schemas": {
                "Thing": {
                    "type": "object",
                    "required": ["id", "version"],
                    "properties": {
                        "id": {"type": "string"},
                        "version": {"type": "integer", "x-ticket": "T-X"},
                        "name": {"type": "string", "x-ticket": "T-Y"},
                    },
                }
            }
        },
    }
    result = strip_pending(spec, {"T-X"})
    assert set(result["paths"]) == {"/a", "/c"}
    assert set(result["paths"]["/a"]) == {"get"}
    assert [p["name"] for p in result["paths"]["/a"]["get"]["parameters"]] == ["keep"]
    thing = result["components"]["schemas"]["Thing"]
    assert set(thing["properties"]) == {"id", "name"}
    assert thing["required"] == ["id"]
    assert spec["components"]["schemas"]["Thing"]["required"] == ["id", "version"]  # input intact


def test_pending_tickets_are_hidden_from_the_loaded_contract() -> None:
    import yaml

    from tests.contract import OPENAPI_PATH

    raw = yaml.safe_load(OPENAPI_PATH.read_text())
    expected_hidden = {
        op["operationId"]
        for item in raw["paths"].values()
        for method, op in item.items()
        if method in {"get", "post", "patch", "put", "delete"}
        and op.get("x-ticket") in PENDING_TICKETS
    }
    visible = set(contract_operations().values())
    assert not expected_hidden & visible
    assert "getBranding" in visible or "T-002a" in PENDING_TICKETS
