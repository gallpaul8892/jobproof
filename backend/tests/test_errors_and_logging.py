import json
import logging
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.errors import ProblemError
from app.main import create_app
from tests.contract import assert_contract


def test_unknown_route_is_problem_json_and_echoes_request_id(client: TestClient) -> None:
    response = client.get("/api/v1/does-not-exist", headers={"X-Request-ID": "abc-123"})
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.headers["x-request-id"] == "abc-123"
    body = response.json()
    assert body["code"] == "not_found"
    assert body["request_id"] == "abc-123"
    assert body["instance"] == "/api/v1/does-not-exist"
    assert body["type"] == "https://jobproof.dev/problems/not_found"


def test_request_id_is_generated_when_missing_or_invalid(client: TestClient) -> None:
    generated = client.get("/health").headers["x-request-id"]
    assert re.fullmatch(r"[0-9a-f-]{36}", generated)
    replaced = client.get("/health", headers={"X-Request-ID": "bad id!"}).headers["x-request-id"]
    assert replaced != "bad id!"
    assert re.fullmatch(r"[0-9a-f-]{36}", replaced)


def test_access_log_is_one_json_line(
    client: TestClient, capsys: pytest.CaptureFixture[str]
) -> None:
    # The JSON handler writes to sys.stdout captured at setup time, so attach a probe handler.
    from app.logging import JsonFormatter

    lines: list[str] = []

    class Probe(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            lines.append(JsonFormatter().format(record))

    probe = Probe()
    logger = logging.getLogger("jobproof.access")
    logger.addHandler(probe)
    try:
        client.get("/api/v1/does-not-exist?sig=secret", headers={"X-Request-ID": "abc-123"})
    finally:
        logger.removeHandler(probe)
    assert len(lines) == 1
    entry = json.loads(lines[0])
    assert {"ts", "level", "msg", "request_id", "method", "path", "status", "duration_ms"} <= set(
        entry
    )
    assert entry["request_id"] == "abc-123"
    assert entry["method"] == "GET"
    assert entry["path"] == "/api/v1/does-not-exist"
    assert entry["status"] == 404
    assert "secret" not in lines[0]


def _app_with_failures() -> FastAPI:
    app = create_app()

    @app.get("/boom")
    def boom() -> None:
        raise RuntimeError("secret internals")

    @app.get("/problem")
    def problem() -> None:
        raise ProblemError(403, "forbidden", "Manager role required.")

    @app.get("/typed")
    def typed(n: int) -> int:
        return n

    return app


def test_unhandled_error_is_a_generic_500() -> None:
    with TestClient(_app_with_failures(), raise_server_exceptions=False) as client:
        response = client.get("/boom", headers={"X-Request-ID": "req-500"})
    assert response.status_code == 500
    assert response.headers["x-request-id"] == "req-500"
    body = response.json()
    assert body["code"] == "internal_error"
    assert body["request_id"] == "req-500"
    assert "secret internals" not in response.text
    assert "Traceback" not in response.text


def test_problem_error_and_validation_error_shapes() -> None:
    with TestClient(_app_with_failures()) as client:
        forbidden = client.get("/problem")
        invalid = client.get("/typed", params={"n": "x"})
    assert forbidden.status_code == 403
    assert forbidden.json()["code"] == "forbidden"
    assert forbidden.json()["detail"] == "Manager role required."
    assert invalid.status_code == 422
    body = invalid.json()
    assert body["code"] == "validation_error"
    assert body["errors"][0]["loc"] == ["query", "n"]


def test_cors_allows_configured_origin_only(client: TestClient) -> None:
    ok = client.get("/health", headers={"Origin": "http://localhost:8080"})
    assert ok.headers["access-control-allow-origin"] == "http://localhost:8080"
    assert "x-request-id" in ok.headers["access-control-expose-headers"].lower()
    other = client.get("/health", headers={"Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in other.headers
    assert_contract(ok, "getHealth")
