"""Contract helpers: assert responses against api/openapi.yaml and route parity."""

from functools import lru_cache
from pathlib import Path
from typing import Any

import httpx
import yaml
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

OPENAPI_PATH = Path(__file__).resolve().parents[2] / "api" / "openapi.yaml"
_BASE_URI = "urn:jobproof:openapi"
_HTTP_METHODS = {"get", "put", "post", "delete", "patch", "head", "options"}

# (METHOD, path) of operations in the contract that are not built yet. Empty since T-001c.
NOT_YET_IMPLEMENTED: set[tuple[str, str]] = set()

# Tickets whose contract items (operations, parameters, schema properties marked `x-ticket`) are
# not built yet. load_spec() hides them so the contract tests stay green while a package is built
# ticket by ticket. Delete a ticket's id from this set as the last step of that ticket.
# T-003 (operative app, contract v0.6.0) staged by the architect on 2026-11-09: each ticket
# removes its own id as its last step (specs/T-003-work-packages.md). T-003e, i, j, l, m, n and p
# have no contract items of their own.
PENDING_TICKETS: set[str] = {
    "T-003c",
    "T-003d",
    "T-003f",
    "T-003g",
    "T-003h",
    "T-003k",
    "T-003o",
}


def _is_pending(node: Any, pending: set[str]) -> bool:
    return isinstance(node, dict) and node.get("x-ticket") in pending


def strip_pending(node: Any, pending: set[str]) -> Any:
    """Copy of `node` without any mapping or list item whose `x-ticket` is in `pending`.

    Schema properties removed this way are also removed from the sibling `required` list, and a
    path left without operations is dropped.
    """
    if isinstance(node, list):
        return [strip_pending(item, pending) for item in node if not _is_pending(item, pending)]
    if not isinstance(node, dict):
        return node
    result = {
        key: strip_pending(value, pending)
        for key, value in node.items()
        if not _is_pending(value, pending)
    }
    properties = node.get("properties")
    if isinstance(properties, dict) and isinstance(result.get("required"), list):
        removed = {name for name, value in properties.items() if _is_pending(value, pending)}
        result["required"] = [name for name in result["required"] if name not in removed]
    if isinstance(result.get("paths"), dict):
        result["paths"] = {
            path: item
            for path, item in result["paths"].items()
            if any(method in _HTTP_METHODS for method in item)
        }
    return result


@lru_cache
def load_spec() -> dict[str, Any]:
    with OPENAPI_PATH.open() as handle:
        spec: dict[str, Any] = yaml.safe_load(handle)
    stripped: dict[str, Any] = strip_pending(spec, PENDING_TICKETS)
    return stripped


def contract_operations() -> dict[tuple[str, str], str]:
    """Map (METHOD, path) to operationId for every operation in the contract."""
    result: dict[tuple[str, str], str] = {}
    for path, item in load_spec()["paths"].items():
        for method, operation in item.items():
            if method in _HTTP_METHODS:
                result[(method.upper(), path)] = operation["operationId"]
    return result


def _find_operation(operation_id: str) -> dict[str, Any]:
    for item in load_spec()["paths"].values():
        for method, operation in item.items():
            if method in _HTTP_METHODS and operation["operationId"] == operation_id:
                found: dict[str, Any] = operation
                return found
    raise AssertionError(f"operationId {operation_id!r} is not in the contract")


def _resolve_response(response_spec: dict[str, Any]) -> dict[str, Any]:
    ref = response_spec.get("$ref")
    if ref is None:
        return response_spec
    node: Any = load_spec()
    for part in ref.removeprefix("#/").split("/"):
        node = node[part]
    resolved: dict[str, Any] = node
    return resolved


def _absolute_refs(node: Any) -> Any:
    """Point every local "#/..." $ref at the registered contract document."""
    if isinstance(node, dict):
        return {
            key: (
                f"{_BASE_URI}{value}"
                if key == "$ref" and str(value).startswith("#")
                else _absolute_refs(value)
            )
            for key, value in node.items()
        }
    if isinstance(node, list):
        return [_absolute_refs(item) for item in node]
    return node


@lru_cache
def _registry() -> Registry[Any]:
    resource = Resource.from_contents(load_spec(), default_specification=DRAFT202012)
    return Registry().with_resource(_BASE_URI, resource)


def assert_contract(response: httpx.Response, operation_id: str) -> None:
    """Fail unless the status is declared for the operation and the JSON body fits its schema."""
    operation = _find_operation(operation_id)
    declared = operation["responses"]
    status = str(response.status_code)
    assert status in declared, (
        f"{operation_id}: status {status} is not declared in the contract ({sorted(declared)})"
    )
    spec = _resolve_response(declared[status])
    content = spec.get("content", {})
    if not content:
        return
    media_type = response.headers.get("content-type", "").split(";")[0].strip()
    assert media_type in content, (
        f"{operation_id}: content type {media_type!r} is not declared for {status} "
        f"({sorted(content)})"
    )
    if not media_type.endswith("json"):
        return
    schema = _absolute_refs(content[media_type]["schema"])
    validator = Draft202012Validator(schema, registry=_registry(), format_checker=FormatChecker())
    errors = sorted(validator.iter_errors(response.json()), key=lambda e: list(e.path))
    assert not errors, f"{operation_id}: response body violates the contract: " + "; ".join(
        f"{'/'.join(str(p) for p in e.path) or '<root>'}: {e.message}" for e in errors
    )
