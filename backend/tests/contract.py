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


@lru_cache
def load_spec() -> dict[str, Any]:
    with OPENAPI_PATH.open() as handle:
        spec: dict[str, Any] = yaml.safe_load(handle)
    return spec


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
